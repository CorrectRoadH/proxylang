import { deepFreeze } from "./schema.js";
import { isIP } from "node:net";
import type { Profile, ProfileCondition } from "./profile-types.js";
import type { SurgeCondition } from "./surge-schema.js";
import {
  exactDefinition,
  inspectDefinition,
  snapshotDefinition,
  ProfileDefinitionError,
} from "./definitions.js";
import type { ProfileDestination, ProxyGroupDefinition, RouteDefinition } from "./profile-types.js";
import type { SurgePolicy, SurgeProfileInput } from "./surge-schema.js";
const outbound = {
  direct: { builtin: "DIRECT" },
  reject: { builtin: "REJECT" },
  rejectDrop: { builtin: "REJECT-DROP" },
  rejectNoDrop: { builtin: "REJECT-NO-DROP" },
  rejectTinyGif: { builtin: "REJECT-TINYGIF" },
};
type SurgeDefinitionInput = Omit<SurgeProfileInput, "groups" | "rules" | "fallback"> & {
  readonly groups: readonly ProxyGroupDefinition[];
  readonly routes: readonly RouteDefinition[];
  readonly fallback: ProfileDestination;
};
const fail = (code: string): never => {
  throw new ProfileDefinitionError(code);
};
function lowerSurgeProfile(input: SurgeDefinitionInput) {
  inspectDefinition(input);
  exactDefinition(input, [
    "target",
    "managed",
    "general",
    "hosts",
    "nodes",
    "tunnels",
    "names",
    "groups",
    "routes",
    "fallback",
  ]);
  if (
    !Array.isArray(input.nodes) ||
    !Array.isArray(input.groups) ||
    !Array.isArray(input.routes) ||
    (input.tunnels !== undefined && !Array.isArray(input.tunnels))
  )
    fail("DEFINITION_NOT_DATA");
  const registry = new Map<string, { readonly id: string }>();
  const names: Record<string, string> = Object.assign(Object.create(null), input.names);
  for (const resource of [...input.nodes, ...(input.tunnels ?? []), ...input.groups]) {
    if (!resource || typeof resource !== "object" || typeof resource.id !== "string")
      fail("INVALID_RESOURCE_DEFINITION");
    registry.set(resource.id, resource);
    const name = "name" in resource ? (resource.name ?? resource.id) : resource.id;
    if (
      resource.type === "proxy-group" &&
      names[resource.id] !== undefined &&
      names[resource.id] !== name
    )
      fail("GROUP_NAME_CONFLICT");
    Object.defineProperty(names, resource.id, {
      value: names[resource.id] ?? name,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  function lower(destination: ProfileDestination): SurgePolicy {
    if (!destination || typeof destination !== "object") fail("INVALID_DESTINATION");
    if ("builtin" in destination) {
      exactDefinition(destination, ["builtin"]);
      if (!Object.values(outbound).some((value) => value.builtin === destination.builtin))
        fail("INVALID_DESTINATION");
      return { builtin: destination.builtin };
    }
    return { ref: destination.id };
  }
  const groups = input.groups.map((definition) => {
    exactDefinition(definition, ["type", "id", "name", "algorithm", "members", "surge"]);
    if (definition.type !== "proxy-group") fail("INVALID_GROUP_DEFINITION");
    if (
      !definition.algorithm ||
      !["select", "surge-smart", "auto"].includes(definition.algorithm.type)
    )
      fail("UNSUPPORTED_GROUP_ALGORITHM");
    exactDefinition(definition.algorithm, ["type"]);
    if (!Array.isArray(definition.members)) fail("INVALID_GROUP_DEFINITION");
    const { id } = definition;
    return {
      id,
      type: definition.algorithm.type === "select" ? ("select" as const) : ("smart" as const),
      members: definition.members.map(lower),
      ...definition.surge,
    };
  });
  const rules = input.routes.map((definition) => {
    exactDefinition(definition, ["type", "when", "to"]);
    if (definition.type !== "route") fail("INVALID_ROUTE_DEFINITION");
    return { when: definition.when, then: lower(definition.to) };
  });
  const { routes: _routes, groups: _groups, fallback, ...rest } = input;
  return deepFreeze(
    snapshotDefinition({ ...rest, names, groups, rules, fallback: lower(fallback) }),
  );
}
function surgeCondition(
  c: ProfileCondition | import("./types.js").Match,
  depth = 0,
): SurgeCondition {
  if (depth > 10) throw new ProfileDefinitionError("LOGICAL_DEPTH_EXCEEDED");
  if (c.type === "nativeRuleSet") {
    if (c.engine !== "surge") throw new ProfileDefinitionError("PROFILE_CONDITION_UNSUPPORTED");
    if (depth && c.intervalSeconds !== undefined)
      throw new ProfileDefinitionError("RULESET_COMPOSITION_UNSUPPORTED");
    const { engine: _engine, id: _id, ...fields } = c;
    return { ...fields, type: "ruleSet" };
  }
  if (c.type === "ruleSet") return { type: "ruleSet", format: "rule-set", builtin: c.builtin };
  if (c.type === "all" || c.type === "any")
    return c.conditions.length === 1
      ? surgeCondition(c.conditions[0]!, depth + 1)
      : { ...c, conditions: c.conditions.map((x) => surgeCondition(x, depth + 1)) };
  if (c.type === "not") return { ...c, condition: surgeCondition(c.condition, depth + 1) };
  if (c.type === "ipCidr" && isIP(c.value.split("/")[0]!) === 6) return { ...c, type: "ipCidr6" };
  return c as SurgeCondition;
}

export function normalizeSurgeProfile(p: Profile) {
  const nodes = p.proxies.filter(
    (x) => !["tailscale", "wireguard", "sing-box-tailscale"].includes(x.type),
  );
  const tunnels = p.proxies.filter((x) => ["tailscale", "wireguard"].includes(x.type));
  if (p.proxies.some((x) => x.type === "sing-box-tailscale"))
    throw new ProfileDefinitionError("PROFILE_ENDPOINT_UNSUPPORTED");
  const groups = p.groups;
  return lowerSurgeProfile({
    target: p.target,
    ...p.surge,
    ...(p.dns?.length ? { hosts: [...p.dns, ...(p.surge?.hosts ?? [])] } : {}),
    nodes: nodes.map((n) => {
      const { name: _name, ...rest } = n;
      return { ...rest, ...("via" in rest && rest.via ? { via: rest.via.id } : {}) };
    }),
    tunnels: tunnels.map((t) => {
      const { name: _name, ...rest } = t;
      return rest;
    }),
    names: Object.fromEntries([...p.proxies, ...p.groups].map((r) => [r.id, r.name ?? r.id])),
    groups,
    routes: p.routes.map((r) => ({ ...r, when: surgeCondition(r.when) })),
    fallback: p.fallback,
  } as Parameters<typeof lowerSurgeProfile>[0]);
}
