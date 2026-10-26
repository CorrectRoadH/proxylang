// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/surge-profile.md
import type { GroupAlgorithm } from "./types.js";
import type { SurgeCondition, SurgePolicy, SurgeProfileInput } from "./surge-profile.js";

import type { ProfileCondition, ProfileDestination } from "./profile.js";

export interface ProxyGroupDefinition {
  readonly type: "proxy-group";
  readonly id: string;
  readonly name: string;
  readonly algorithm: GroupAlgorithm;
  readonly members: readonly ProfileDestination[];
  readonly url?: string;
  readonly intervalSeconds?: number;
  readonly timeoutSeconds?: number;
}
export type RouteDefinition = {
  readonly type: "route";
  readonly when: ProfileCondition;
  readonly to: ProfileDestination;
};
export type SurgeDefinitionInput = Omit<SurgeProfileInput, "groups" | "rules" | "fallback"> & {
  readonly groups: readonly ProxyGroupDefinition[];
  readonly routes: readonly RouteDefinition[];
  readonly fallback: ProfileDestination;
};
// tsx can load a second SDK instance: classify data descriptors, never messages or getters.
const definitionCodes = new Set([
  "DEFINITION_CYCLE",
  "DEFINITION_DEPTH_EXCEEDED",
  "DEFINITION_EDGE_BUDGET_EXCEEDED",
  "DEFINITION_NOT_DATA",
  "DEFINITION_OBJECT_BUDGET_EXCEEDED",
  "DEFINITION_OUTPUT_BUDGET_EXCEEDED",
  "DEFINITION_UNKNOWN_FIELD",
  "DNS_HOSTS_CONFLICT",
  "DNS_RULE_CONFLICT",
  "DUPLICATE_RESOURCE_ID",
  "GROUP_NAME_CONFLICT",
  "INVALID_BUILD_DEFINITION",
  "INVALID_DESTINATION",
  "INVALID_DNS_RULE",
  "INVALID_DNS_RULES",
  "INVALID_GROUP_DEFINITION",
  "INVALID_MATCH_OPTIONS",
  "INVALID_NATIVE_RULESET",
  "INVALID_PROFILE_DEFINITION",
  "INVALID_RESOURCE_DEFINITION",
  "INVALID_ROUTE_DEFINITION",
  "INVALID_SECRETS_DEFINITION",
  "INVALID_SURGE_GENERAL",
  "INVALID_SURGE_HOSTS",
  "LOGICAL_DEPTH_EXCEEDED",
  "PROFILE_CONDITION_UNSUPPORTED",
  "PROFILE_DESTINATION_UNSUPPORTED",
  "PROFILE_ENDPOINT_UNSUPPORTED",
  "PROFILE_EXTENSION_UNSUPPORTED",
  "PROFILE_GROUP_MEMBER_UNSUPPORTED",
  "PROFILE_GROUP_OPTIONS_UNSUPPORTED",
  "PROFILE_TARGET_UNSUPPORTED",
  "RULESET_COMPOSITION_UNSUPPORTED",
  "UNKNOWN_DESTINATION_ID",
  "UNREGISTERED_DESTINATION_INSTANCE",
  "UNSUPPORTED_GROUP_ALGORITHM",
]);
function validDiagnosticPath(path: unknown): path is string {
  return typeof path === "string" && /^(dns|surge\.hosts)\[\d{1,4}\]$/.test(path);
}
export function definitionDiagnostic(
  error: unknown,
): { readonly code: string; readonly paths?: readonly string[] } | undefined {
  try {
    if (!error || typeof error !== "object") return;
    const name: unknown = Object.getOwnPropertyDescriptor(error, "name")?.value;
    const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value;
    if (name !== "ProfileDefinitionError" || typeof code !== "string" || !definitionCodes.has(code))
      return;
    const paths: unknown = Object.getOwnPropertyDescriptor(error, "paths")?.value;
    // Copy only two own data fields; do not iterate arbitrary arrays or invoke getters.
    if (
      code === "DNS_HOSTS_CONFLICT" &&
      Array.isArray(paths) &&
      Object.getOwnPropertyDescriptor(paths, "length")?.value === 2
    ) {
      const first: unknown = Object.getOwnPropertyDescriptor(paths, "0")?.value;
      const second: unknown = Object.getOwnPropertyDescriptor(paths, "1")?.value;
      if (validDiagnosticPath(first) && validDiagnosticPath(second))
        return { code, paths: [first, second] };
    }
    return { code };
  } catch {
    return;
  }
}
export class ProfileDefinitionError extends Error {
  readonly paths?: readonly string[];
  constructor(
    readonly code: string,
    paths?: readonly string[],
  ) {
    super(code);
    this.name = "ProfileDefinitionError";
    if (paths?.length === 2 && paths.every(validDiagnosticPath))
      this.paths = Object.freeze([...paths]);
  }
}
const fail = (code: string): never => {
  throw new ProfileDefinitionError(code);
};

/** Inspect descriptors before any caller spreads or reads input fields. Shared DAGs are legal. */
export function inspectDefinition(root: unknown): void {
  let edges = 0;
  let objects = 0;
  const visiting = new Set<object>();
  const heights = new Map<object, number>();
  function visit(value: unknown, depth: number): number {
    if (depth > 64) fail("DEFINITION_DEPTH_EXCEEDED");
    if (value === null || typeof value !== "object") {
      if (!["undefined", "string", "number", "boolean"].includes(typeof value) && value !== null)
        fail("DEFINITION_NOT_DATA");
      return 0;
    }
    if (visiting.has(value)) fail("DEFINITION_CYCLE");
    const cached = heights.get(value);
    if (cached !== undefined) {
      if (depth + cached > 64) fail("DEFINITION_DEPTH_EXCEEDED");
      return cached;
    }
    if (++objects > 20000) fail("DEFINITION_OBJECT_BUDGET_EXCEEDED");
    const proto = Object.getPrototypeOf(value);
    if (
      proto !== Object.prototype &&
      proto !== null &&
      !(Array.isArray(value) && proto === Array.prototype)
    )
      fail("DEFINITION_NOT_DATA");
    if (Array.isArray(value) && value.length > 100000) fail("DEFINITION_EDGE_BUDGET_EXCEEDED");
    visiting.add(value);
    let height = 0;
    for (const key of Reflect.ownKeys(value)) {
      if (++edges > 100000) fail("DEFINITION_EDGE_BUDGET_EXCEEDED");
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (
        typeof key !== "string" ||
        !("value" in descriptor) ||
        (!descriptor.enumerable && !(Array.isArray(value) && key === "length"))
      )
        fail("DEFINITION_NOT_DATA");
      height = Math.max(height, 1 + visit(descriptor.value, depth + 1));
    }
    visiting.delete(value);
    heights.set(value, height);
    return height;
  }
  visit(root, 0);
}

/** Count output occurrences, not identities, before allocating each copied value. */
function snapshot<T>(input: T): T {
  let remaining = 100000;
  function copy(value: unknown, depth: number): unknown {
    if (--remaining < 0) fail("DEFINITION_OUTPUT_BUDGET_EXCEEDED");
    if (depth > 64) fail("DEFINITION_DEPTH_EXCEEDED");
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      for (const item of value) output.push(copy(item, depth + 1));
      return output;
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value))
      Object.defineProperty(output, key, {
        value: copy(item, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return output;
  }
  return copy(input, 0) as T;
}
export function snapshotDefinition<T>(input: T): T {
  inspectDefinition(input);
  return snapshot(input);
}
export function exactDefinition(value: object, keys: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("DEFINITION_NOT_DATA");
  if (Object.keys(value).some((key) => !keys.includes(key))) fail("DEFINITION_UNKNOWN_FIELD");
}
export const outbound = {
  direct: Object.freeze({ builtin: "DIRECT" } as const),
  reject: Object.freeze({ builtin: "REJECT" } as const),
  rejectDrop: Object.freeze({ builtin: "REJECT-DROP" } as const),
  rejectNoDrop: Object.freeze({ builtin: "REJECT-NO-DROP" } as const),
  rejectTinyGif: Object.freeze({ builtin: "REJECT-TINYGIF" } as const),
};
export function defineProxyGroup(input: Omit<ProxyGroupDefinition, "type">): ProxyGroupDefinition {
  inspectDefinition(input);
  exactDefinition(input, [
    "id",
    "name",
    "algorithm",
    "members",
    "url",
    "intervalSeconds",
    "timeoutSeconds",
  ]);
  if (!input.algorithm || !["select", "surge-smart", "urltest"].includes(input.algorithm.type))
    fail("UNSUPPORTED_GROUP_ALGORITHM");
  exactDefinition(
    input.algorithm,
    input.algorithm.type === "urltest"
      ? ["type", "url", "intervalSeconds", "toleranceMs"]
      : ["type"],
  );
  if (!Array.isArray(input.members)) fail("INVALID_GROUP_DEFINITION");
  return {
    ...input,
    type: "proxy-group",
    algorithm: { ...input.algorithm },
    members: [...input.members],
  };
}
export function defineRoute(input: Omit<RouteDefinition, "type">): RouteDefinition {
  inspectDefinition(input);
  exactDefinition(input, ["when", "to"]);
  return { ...input, type: "route" };
}
export function defineRoutes(input: {
  readonly when: readonly ProfileCondition[];
  readonly to: ProfileDestination;
}): RouteDefinition[] {
  inspectDefinition(input);
  exactDefinition(input, ["when", "to"]);
  if (!Array.isArray(input.when)) fail("INVALID_ROUTE_DEFINITION");
  return input.when.map((when) => ({ type: "route", when, to: input.to }));
}
export function lowerSurgeProfile(input: SurgeDefinitionInput) {
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
    if (!definition.algorithm || !["select", "surge-smart"].includes(definition.algorithm.type))
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
  return snapshot({ ...rest, names, groups, rules, fallback: lower(fallback) });
}

type Options = { readonly noResolve?: boolean; readonly includeSniffed?: never };
type DomainOptions = { readonly noResolve?: boolean; readonly includeSniffed?: boolean };
function condition<T extends SurgeCondition>(value: T): T {
  inspectDefinition(value);
  const fields =
    value.type === "ruleSet"
      ? ["format", "url", "builtin", "intervalSeconds"]
      : value.type === "all" || value.type === "any"
        ? ["conditions"]
        : value.type === "not"
          ? ["condition"]
          : value.type === "port" || value.type === "sourcePort"
            ? ["from", "to"]
            : ["value"];
  exactDefinition(value, [
    "type",
    "noResolve",
    ...fields,
    ...(["domain", "domainSuffix", "ruleSet"].includes(value.type) ? ["includeSniffed"] : []),
  ]);
  if (value.includeSniffed !== undefined && typeof value.includeSniffed !== "boolean")
    throw new ProfileDefinitionError("INVALID_MATCH_OPTIONS");
  return value;
}
function atom<
  K extends
    | "domain"
    | "domainSuffix"
    | "ipCidr"
    | "ipCidr6"
    | "sourceIp"
    | "processName"
    | "macAddress",
>(type: K) {
  return (
    value: string,
    options?: K extends "domain" | "domainSuffix" ? DomainOptions : Options,
  ): SurgeCondition => {
    inspectDefinition(options ?? {});
    exactDefinition(options ?? {}, [
      "noResolve",
      ...(["domain", "domainSuffix"].includes(type) ? ["includeSniffed"] : []),
    ]);
    return condition({ ...options, type, value } as SurgeCondition);
  };
}
export const surgeMatch = {
  domain: atom("domain"),
  domainSuffix: atom("domainSuffix"),
  ipCidr: atom("ipCidr"),
  ipCidr6: atom("ipCidr6"),
  sourceIp: atom("sourceIp"),
  processName: atom("processName"),
  macAddress: atom("macAddress"),
  network: (value: "tcp" | "udp", options: Options = {}): SurgeCondition => {
    inspectDefinition(options);
    return condition({ ...options, type: "network", value });
  },
  port: (from: number, to?: number, options: Options = {}): SurgeCondition => {
    inspectDefinition(options);
    return condition({ ...options, type: "port", from, ...(to === undefined ? {} : { to }) });
  },
  sourcePort: (from: number, to?: number, options: Options = {}): SurgeCondition => {
    inspectDefinition(options);
    return condition({ ...options, type: "sourcePort", from, ...(to === undefined ? {} : { to }) });
  },
  all: (conditions: readonly SurgeCondition[], options: Options = {}): SurgeCondition => {
    inspectDefinition({ conditions, options });
    return condition({ ...options, type: "all", conditions: [...conditions] });
  },
  any: (conditions: readonly SurgeCondition[], options: Options = {}): SurgeCondition => {
    inspectDefinition({ conditions, options });
    return condition({ ...options, type: "any", conditions: [...conditions] });
  },
  not: (value: SurgeCondition, options: Options = {}): SurgeCondition => {
    inspectDefinition({ value, options });
    return condition({ ...options, type: "not", condition: value });
  },
  ruleSet: (
    options: Omit<Extract<SurgeCondition, { type: "ruleSet" }>, "type">,
  ): SurgeCondition => {
    inspectDefinition(options);
    return condition({ ...options, type: "ruleSet" });
  },
};
