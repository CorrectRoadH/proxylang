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
  const registry = new Map<string, ProfileDestination>();
  const names: Record<string, string> = Object.assign(Object.create(null), input.names);
  for (const resource of [...input.nodes, ...(input.tunnels ?? []), ...input.groups]) {
    if (!resource || typeof resource !== "object" || typeof resource.id !== "string")
      fail("INVALID_RESOURCE_DEFINITION");
    if (registry.has(resource.id)) fail("DUPLICATE_RESOURCE_ID");
    registry.set(resource.id, resource);
    const name =
      resource.type === "proxy-group"
        ? resource.name
        : "label" in resource
          ? (resource.label ?? resource.id)
          : resource.id;
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
    if (typeof destination === "string") {
      if (!registry.has(destination)) fail("UNKNOWN_DESTINATION_ID");
      return { ref: destination };
    }
    if (!destination || typeof destination !== "object") fail("INVALID_DESTINATION");
    if ("builtin" in destination) {
      exactDefinition(destination, ["builtin"]);
      if (!Object.values(outbound).some((value) => value.builtin === destination.builtin))
        fail("INVALID_DESTINATION");
      return { builtin: destination.builtin };
    }
    if (registry.get(destination.id) !== destination) fail("UNREGISTERED_DESTINATION_INSTANCE");
    return { ref: destination.id };
  }
  const groups = input.groups.map((definition) => {
    exactDefinition(definition, [
      "type",
      "id",
      "name",
      "algorithm",
      "members",
      "url",
      "intervalSeconds",
      "timeoutSeconds",
    ]);
    if (definition.type !== "proxy-group") fail("INVALID_GROUP_DEFINITION");
    if (
      !definition.algorithm ||
      !["select", "surge-smart", "auto"].includes(definition.algorithm.type)
    )
      fail("UNSUPPORTED_GROUP_ALGORITHM");
    exactDefinition(definition.algorithm, ["type"]);
    if (!Array.isArray(definition.members)) fail("INVALID_GROUP_DEFINITION");
    const { id, url, intervalSeconds, timeoutSeconds } = definition;
    return {
      id,
      type: definition.algorithm.type === "select" ? ("select" as const) : ("smart" as const),
      members: definition.members.map(lower),
      ...(url === undefined ? {} : { url }),
      ...(intervalSeconds === undefined ? {} : { intervalSeconds }),
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    };
  });
  const rules = input.routes.map((definition) => {
    exactDefinition(definition, ["type", "when", "to"]);
    if (definition.type !== "route") fail("INVALID_ROUTE_DEFINITION");
    return { when: definition.when, then: lower(definition.to) };
  });
  const { routes: _routes, groups: _groups, fallback, ...rest } = input;
  return snapshotDefinition({ ...rest, names, groups, rules, fallback: lower(fallback) });
}
function surgeCondition(c: ProfileCondition, depth = 0): SurgeCondition {
  if (depth > 10) throw new ProfileDefinitionError("LOGICAL_DEPTH_EXCEEDED");
  if (c.type === "nativeRuleSet") {
    if (c.engine !== "surge") throw new ProfileDefinitionError("PROFILE_CONDITION_UNSUPPORTED");
    if (depth && c.intervalSeconds !== undefined)
      throw new ProfileDefinitionError("RULESET_COMPOSITION_UNSUPPORTED");
    const { engine: _engine, id: _id, ...fields } = c;
    return { ...fields, type: "ruleSet" };
  }
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
    nodes,
    tunnels,
    groups,
    routes: p.routes.map((r) => ({ ...r, when: surgeCondition(r.when) })),
    fallback: p.fallback,
  } as Parameters<typeof lowerSurgeProfile>[0]);
}
