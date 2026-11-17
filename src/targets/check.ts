// @concord-file
// @concord-implements docs/feature/targets/README.md
import { truthPossibilities } from "../model/network.js";
import { isIP } from "node:net";
import { targetCatalog } from "./catalog.js";
import { nodeIsTcpOnly, validateProxyOptions } from "./proxies.js";
import { pathsOverlap } from "../model/paths.js";
import type {
  Action,
  Diagnostic,
  EnginePlan,
  Match,
  NativeRuleSet,
  NormalizedProfile,
  ProxyNode,
  ConcreteGroup,
} from "../model/types.js";

export type CheckError = (code: string, path: string) => void;
export interface EngineChecks {
  node(node: ProxyNode, error: CheckError): void;
  group(group: ConcreteGroup, error: CheckError): void;
  profile(error: CheckError): void;
  match(match: Match, path: string, nested: boolean, error: CheckError): void;
}
export function checkTarget(
  model: NormalizedProfile,
  checks: EngineChecks,
): {
  ok: boolean;
  diagnostics: Diagnostic[];
  plan: EnginePlan;
} {
  const diagnostics: Diagnostic[] = [];
  const error = (code: string, path: string) =>
    diagnostics.push({ severity: "error", code, path, message: code, target: "profile" });
  const t = model.target;
  const descriptor = targetCatalog.find(
    (d) =>
      d.engine === t.engine &&
      d.version === t.version &&
      (d.platforms as readonly string[]).includes(t.platform),
  );
  if (!descriptor) error("UNKNOWN_TARGET", "target");
  const resources = [...model.nodes, ...model.groups, ...model.endpoints];
  const registry = new Map(resources.map((r) => [r.id, r]));
  const edges = new Map(
    resources.map((r) => [r.id, "members" in r ? r.members : "via" in r && r.via ? [r.via] : []]),
  );
  if (resources.length > 1000) error("RESOURCE_LIMIT", "proxies");
  for (const [id, refs] of edges)
    for (const [index, ref] of refs.entries()) {
      const path =
        registry.get(id)?.type === "select" || registry.get(id)?.type === "urltest"
          ? `groups.${id}.members[${index}]`
          : `proxies.${id}.via`;
      if (!registry.has(ref) && !["DIRECT", "REJECT"].includes(ref))
        error("MISSING_REFERENCE", path);
      if (registry.get(ref)?.type === "sing-box-tailscale")
        error("ENDPOINT_REFERENCE_UNSUPPORTED", path);
    }
  const state = new Map<string, number>(),
    tcp = new Map<string, boolean>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) {
      error(
        "RESOURCE_CYCLE",
        `${model.groups.some((g) => g.id === id) ? "groups" : "proxies"}.${id}`,
      );
      return true;
    }
    if (state.get(id) === 2) return tcp.get(id) ?? false;
    state.set(id, 1);
    const item = registry.get(id);
    let limited = !!item && "server" in item && nodeIsTcpOnly(item, t.engine, t.version);
    for (const ref of edges.get(id) ?? []) limited = visit(ref) || limited;
    state.set(id, 2);
    tcp.set(id, limited);
    return limited;
  };
  if (resources.length <= 1000) for (const id of registry.keys()) visit(id);
  const action = (a: Action, path: string, udp: boolean) => {
    if (a.type === "route") {
      if (!registry.has(a.to)) error("MISSING_REFERENCE", path);
      else if (udp && tcp.get(a.to) && model.unsupportedUdp !== "reject")
        error("NETWORK_UNSUPPORTED", path);
    }
  };
  model.rules.forEach((r, i) =>
    action(r.then, `routes[${i}].to`, truthPossibilities(r.when, "udp").includes(true)),
  );
  action(model.fallback, "fallback", true);
  for (const node of model.nodes) {
    validateProxyOptions(node, t, diagnostics);
    if (!descriptor?.protocols.includes(node.type as never))
      error("PROTOCOL_UNSUPPORTED", `proxies.${node.id}`);
    checks.node(node, error);
  }
  for (const group of model.groups) {
    if (!descriptor?.groups.includes(group.type as never))
      error("GROUP_UNSUPPORTED", `groups.${group.id}`);
    checks.group(group, error);
  }
  if (t.mode === "standalone" && !model.listener) error("LISTENER_REQUIRED", "listener");
  if (t.mode === "fragment" && model.listener) error("UNUSED_LISTENER", "listener");
  if (
    model.listener &&
    (!Number.isInteger(model.listener.port) ||
      model.listener.port < 1 ||
      model.listener.port > 65535 ||
      !isIP(model.listener.resolver))
  )
    error("INVALID_SCHEMA", "listener");
  checks.profile(error);
  for (const [i, ep] of model.endpoints.entries()) {
    if (!descriptor?.endpoints.includes(ep.type as never))
      error("ENDPOINT_UNSUPPORTED", `proxies.${ep.id}`);
    if (t.mode !== "standalone") error("ENDPOINT_MODE_UNSUPPORTED", `proxies.${ep.id}`);
    if (model.endpoints.slice(0, i).some((x) => pathsOverlap(ep.stateDirectory, x.stateDirectory)))
      error("ENDPOINT_STATE_OVERLAP", `proxies.${ep.id}`);
  }
  const sets = new Map<string, NativeRuleSet>();
  const inspect = (m: Match, path: string, nested = false): void => {
    if (m.type === "all" || m.type === "any") {
      m.conditions.forEach((x, i) => inspect(x, `${path}.conditions[${i}]`, true));
      return;
    }
    if (m.type === "not") {
      inspect(m.condition, path + ".condition", true);
      return;
    }
    checks.match(m, path, nested, error);
    if (m.type === "nativeRuleSet") {
      if (m.engine !== t.engine) error("NATIVE_TARGET_MISMATCH", path);
      if (!descriptor?.nativeRuleSets.includes(m.format as never))
        error("RULESET_UNSUPPORTED", path);
      const prev = sets.get(m.id);
      if (!prev) sets.set(m.id, m);
    }
  };
  model.rules.forEach((r, i) => inspect(r.when, `routes[${i}].when`));
  for (const set of sets.values())
    diagnostics.push({
      severity: "warning",
      code: "EXTERNAL_RULESET_UNVERIFIED",
      path: `ruleSets.${set.id}`,
      message: "External content is owned by the client",
      target: "profile",
    });
  return {
    ok: !diagnostics.some((d) => d.severity === "error"),
    diagnostics,
    plan: { model, nativeRuleSets: [...sets.values()] },
  };
}
