// @concord-file
// @concord-implements docs/feature/profile/library/README.md#引用规则
// @concord-implements docs/feature/targets/README.md#诊断
import { nodeIsTcpOnly } from "./protocols.js";
import { truthPossibilities } from "./network.js";
import type {
  Profile,
  Exit,
  Condition,
  SecretRef,
  Secrets,
  RuleSet,
  ExternalRuleSet,
} from "./profile-types.js";
import type { Diagnostic, NativeRuleSet, Match } from "./types.js";
import { kindOf, originOf } from "./identity.js";
import { nativeNameSchema, isReservedNativeName } from "./names.js";
import { sourceFor } from "./secret-store.js";
export type Selection =
  | { kind: "name"; resource: string; nativeName: string }
  | { kind: "algorithm"; group: string; algorithm: "surge-smart" | "urltest"; parameters?: object }
  | {
      kind: "ruleSet";
      ruleSet: string;
      branch: "surge" | "singBox" | "mihomo";
      nativeName: string;
    };
export type InspectedProfile = {
  diagnostics: Diagnostic[];
  selections: Selection[];
  names: Map<string, string>;
  rules: { type: "route"; when: Condition | Match; to: Exit }[];
  secretRefs: Set<SecretRef>;
  ruleSets: Set<RuleSet>;
  mapped: Map<ExternalRuleSet, NativeRuleSet>;
};
export function inspectProfile(
  profile: Profile,
  key: string,
  secrets?: Secrets,
  checkSecrets = true,
): InspectedProfile {
  const diagnostics: Diagnostic[] = [];
  const selections: Selection[] = [];
  const error = (code: string, path: string, object: unknown, message = code) =>
    diagnostics.push({
      severity: "error",
      code,
      profile: key,
      path,
      message,
      origin: originOf(object) ?? originOf(profile),
    });
  const resources = [...profile.proxies, ...profile.groups];
  const listed = new Set<object>(resources);
  const ids = new Map<string, object>();
  const names = new Map<string, string>();
  const usedNames = new Map<string, object>();
  const id = (object: { id: string }, path: string) => {
    const old = ids.get(object.id);
    if (old && old !== object) error("DUPLICATE_ID", path, object);
    else ids.set(object.id, object);
  };
  for (const resource of resources) {
    const path =
      resource.type === "proxy-group" ? `groups.${resource.id}` : `proxies.${resource.id}`;
    id(resource, path + ".id");
    const name = resource.name ?? resource.id;
    names.set(resource.id, name);
    if (
      usedNames.has(name) ||
      ["DIRECT", "REJECT", "REJECT-DROP", "REJECT-NO-DROP", "REJECT-TINYGIF"].includes(
        name.toUpperCase(),
      ) ||
      isReservedNativeName(name, profile.target.engine)
    )
      error("DUPLICATE_NATIVE_NAME", path + ".name", resource);
    else usedNames.set(name, resource);
    if (
      !nativeNameSchema.safeParse(name).success &&
      !["DIRECT", "REJECT"].includes(name.toUpperCase())
    )
      error("NAME_UNSAFE", path + ".name", resource);
    selections.push({ kind: "name", resource: resource.id, nativeName: name });
  }
  for (const resource of resources) {
    const path =
      resource.type === "proxy-group" ? `groups.${resource.id}` : `proxies.${resource.id}`;
    if (
      (kindOf(resource) === "tunnel" && profile.target.engine !== "surge") ||
      (kindOf(resource) === "endpoint" && profile.target.engine !== "sing-box")
    )
      error("TUNNEL_UNSUPPORTED", path, resource);
    if (resource.type === "proxy-group") {
      if (
        resource.surge !== undefined &&
        (profile.target.engine !== "surge" || resource.algorithm.type !== "select")
      )
        error("GROUP_OPTION_UNSUPPORTED", path + ".surge", resource);
      if (resource.algorithm.type === "surge-smart" && profile.target.engine !== "surge")
        error("ALGORITHM_ENGINE_MISMATCH", path + ".algorithm", resource);
      else if (
        (resource.algorithm.type === "auto" && profile.target.engine === "stash") ||
        (resource.algorithm.type === "urltest" &&
          ["surge", "stash"].includes(profile.target.engine))
      )
        error("GROUP_ALGORITHM_UNSUPPORTED", path + ".algorithm", resource);
    }
  }
  const reference = (exit: Exit, path: string, owner: unknown) => {
    if (kindOf(exit) !== "builtin" && !listed.has(exit)) error("UNLISTED_EXIT", path, owner);
    if (
      profile.target.engine !== "surge" &&
      "builtin" in exit &&
      !["DIRECT", "REJECT"].includes(exit.builtin)
    )
      error("EXIT_UNSUPPORTED", path, owner);
  };
  const edges = new Map<object, object[]>();
  for (const resource of resources) {
    const path =
      resource.type === "proxy-group" ? `groups.${resource.id}` : `proxies.${resource.id}`;
    if (resource.type === "proxy-group") {
      resource.members.forEach((m, i) => {
        reference(m, `${path}.members[${i}]`, resource);
        if (kindOf(m) === "endpoint")
          error("MEMBER_TYPE_UNSUPPORTED", `${path}.members[${i}]`, resource);
      });
      edges.set(
        resource,
        resource.members.filter((m) => kindOf(m) !== "builtin"),
      );
      if (resource.algorithm.type === "auto" && profile.target.engine !== "stash")
        selections.push({
          kind: "algorithm",
          group: resource.id,
          algorithm: profile.target.engine === "surge" ? "surge-smart" : "urltest",
          ...(profile.target.engine === "surge"
            ? {}
            : {
                parameters: {
                  url: "https://www.gstatic.com/generate_204",
                  intervalSeconds: 180,
                  toleranceMs: 50,
                },
              }),
        });
    } else if ("via" in resource && resource.via) {
      reference(resource.via, path + ".via", resource);
      edges.set(resource, [resource.via]);
    }
  }
  const active: object[] = [];
  const visited = new Set<object>();
  const cycleKeys = new Set<string>();
  const visit = (v: object) => {
    const at = active.indexOf(v);
    if (at !== -1) {
      const cycle = active.slice(at) as { id: string }[];
      const ids = cycle.map((r) => r.id);
      const signature = [...ids].sort().join(",");
      if (!cycleKeys.has(signature)) {
        cycleKeys.add(signature);
        error(
          "GROUP_CYCLE",
          `${kindOf(v) === "group" ? "groups" : "proxies"}.${ids[0]}`,
          v,
          `Dependency cycle: ${ids.join(" -> ")}`,
        );
      }
      return;
    }
    if (visited.has(v)) return;
    active.push(v);
    for (const edge of edges.get(v) ?? []) visit(edge);
    active.pop();
    visited.add(v);
  };
  resources.forEach(visit);
  const tcpCache = new Map<object, boolean>();
  const tcpVisiting = new Set<object>();
  const tcpOnly = (exit: Exit): boolean => {
    const cached = tcpCache.get(exit);
    if (cached !== undefined) return cached;
    if (tcpVisiting.has(exit)) return false;
    tcpVisiting.add(exit);
    let tcp =
      kindOf(exit) === "node" &&
      nodeIsTcpOnly(exit as unknown as import("./types.js").ProxyNode, profile.target.engine);
    for (const edge of edges.get(exit) ?? []) tcp = tcpOnly(edge as Exit) || tcp;
    tcpVisiting.delete(exit);
    tcpCache.set(exit, tcp);
    return tcp;
  };
  const rejectUnsupportedSurgeUdp =
    profile.target.engine === "surge" &&
    profile.surge?.general?.["udp-policy-not-supported-behaviour"] === "REJECT";
  const relayCache = new Map<object, boolean>();
  const relayVisiting = new Set<object>();
  // @concord-code
  // @concord-implements docs/feature/profile/library/surge.md#不支持-udp-的出口
  const unsafeSurgeRelay = (exit: Exit): boolean => {
    const cached = relayCache.get(exit);
    if (cached !== undefined) return cached;
    if (relayVisiting.has(exit)) return false;
    relayVisiting.add(exit);
    // Only terminal capability is exempt. Every possible preceding hop stays strict.
    const unsafe =
      kindOf(exit) === "group"
        ? (edges.get(exit) ?? []).some((member) => unsafeSurgeRelay(member as Exit))
        : "via" in exit && exit.via !== undefined && tcpOnly(exit.via);
    relayVisiting.delete(exit);
    relayCache.set(exit, unsafe);
    return unsafe;
  };
  const requiresTcp = (exit: Exit) =>
    rejectUnsupportedSurgeUdp ? unsafeSurgeRelay(exit) : tcpOnly(exit);
  if (!(profile.target.engine === "sing-box" && profile.singBox?.unsupportedUdp === "reject")) {
    profile.routes.forEach((route, i) => {
      if (requiresTcp(route.to) && truthPossibilities(route.when as Match, "udp").includes(true))
        error("TCP_ONLY_EXIT", `routes[${i}].to`, route);
    });
    if (requiresTcp(profile.fallback)) error("TCP_ONLY_EXIT", "fallback", profile);
  }
  const secretRefs = new Set<SecretRef>();
  const scanned = new WeakSet<object>();
  function scan(value: unknown, path: string, owner: unknown) {
    if (!value || typeof value !== "object") return;
    if (kindOf(value) === "secret") {
      const ref = value as SecretRef;
      secretRefs.add(ref);
      if (checkSecrets && !sourceFor(secrets, ref)) error("SECRET_UNDECLARED", path, owner);
      return;
    }
    // References own their diagnostics; shared containers are checked at every use path.
    if (value !== owner && ["node", "group", "tunnel", "endpoint"].includes(kindOf(value) ?? ""))
      return;
    if (scanned.has(value)) return;
    scanned.add(value);
    if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${path}[${i}]`, owner));
    else for (const [k, v] of Object.entries(value)) scan(v, `${path}.${k}`, owner);
    scanned.delete(value);
  }
  profile.proxies.forEach((r) => scan(r, `proxies.${r.id}`, r));
  if (profile.surge) scan(profile.surge, "surge", profile);
  const sources = new Map<string, { signature: string; nativeName: string }>();
  const mapped = new Map<ExternalRuleSet, NativeRuleSet>();
  const usedSets = new Set<RuleSet>();
  const branch =
    profile.target.engine === "sing-box"
      ? "singBox"
      : profile.target.engine === "mihomo"
        ? "mihomo"
        : "surge";
  function lower(condition: Condition, path: string, depth = 0): Match | Condition {
    if (
      profile.target.engine === "surge" &&
      depth >= 10 &&
      ["all", "any", "not"].includes(condition.type)
    ) {
      error("LOGICAL_DEPTH_EXCEEDED", path, condition);
      return { type: "domain", value: "diagnostic.example" };
    }
    if (condition.type === "all" || condition.type === "any")
      return {
        ...condition,
        conditions: condition.conditions.map((c, i) =>
          lower(c, `${path}.conditions[${i}]`, depth + 1),
        ),
      } as Condition;
    if (condition.type === "not")
      return {
        ...condition,
        condition: lower(condition.condition, path + ".condition", depth + 1),
      } as Condition;
    const placeholder: Match = { type: "domain", value: "diagnostic.example" };
    if (profile.target.engine === "surge" && depth > 10) {
      error("LOGICAL_DEPTH_EXCEEDED", path, condition);
      return placeholder;
    }
    if (
      profile.target.engine !== "surge" &&
      ["ruleSet", "ipAsn", "ipCidr6", "macAddress"].includes(condition.type)
    ) {
      error(
        condition.type === "ruleSet" && profile.target.engine === "stash"
          ? "RULESET_UNSUPPORTED"
          : "CONDITION_UNSUPPORTED",
        path,
        condition,
      );
      return placeholder;
    }
    if (condition.type !== "ruleSetSource") return condition;
    const set = condition;
    id(set, path);
    if (profile.target.engine === "stash") {
      error("RULESET_UNSUPPORTED", path, set);
      return placeholder;
    }
    const source = set[branch];
    if (!source) {
      error("RULESET_SOURCE_MISSING", path, set);
      return placeholder;
    }
    const format = "format" in source ? (source.format ?? "rule-set") : "rule-set";
    const signature = JSON.stringify([
      format,
      source.intervalSeconds ?? 86400,
      "behavior" in source ? source.behavior : undefined,
    ]);
    const previous = sources.get(source.url);
    if (previous && previous.signature !== signature) error("RULESET_SOURCE_CONFLICT", path, set);
    const nativeName = previous && branch !== "surge" ? previous.nativeName : set.id;
    if (!previous) sources.set(source.url, { signature, nativeName: set.id });
    if (!usedSets.has(set)) {
      selections.push({ kind: "ruleSet", ruleSet: set.id, branch, nativeName });
      usedSets.add(set);
    }
    if (branch === "surge" && depth && source.intervalSeconds !== undefined)
      error("CONDITION_UNSUPPORTED", path, set);
    const native = {
      type: "nativeRuleSet",
      id: nativeName,
      engine: profile.target.engine,
      format,
      ...source,
      ...(branch === "surge" && depth ? { intervalSeconds: undefined } : {}),
    } as NativeRuleSet;
    mapped.set(set, native);
    return native;
  }
  const rules = profile.routes.map((route, i) => {
    reference(route.to, `routes[${i}].to`, route);
    return { ...route, when: lower(route.when, `routes[${i}].when`) };
  });
  reference(profile.fallback, "fallback", profile);
  profile.cases?.forEach((c, i) => reference(c.expect, `cases[${i}].expect`, c));
  return { diagnostics, selections, names, rules, secretRefs, ruleSets: usedSets, mapped };
}
