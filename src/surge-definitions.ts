// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/surge-profile.md
import type { GroupAlgorithm, ProxyNode } from "./types.js";
import type {
  SurgeCondition,
  SurgePolicy,
  SurgeProfileInput,
  SurgeTunnel,
} from "./surge-profile.js";

type Builtin = Extract<SurgePolicy, { builtin: string }>;
export type Destination = ProxyNode | ProxyGroupDefinition | SurgeTunnel | Builtin;
export type ProxyGroupDefinition = {
  readonly type: "proxy-group";
  readonly id: string;
  readonly name: string;
  readonly algorithm: Extract<GroupAlgorithm, { type: "select" | "surge-smart" }>;
  readonly members: readonly Destination[];
  readonly url?: string;
  readonly intervalSeconds?: number;
  readonly timeoutSeconds?: number;
};
export type RouteDefinition = {
  readonly type: "route";
  readonly when: SurgeCondition;
  readonly to: Destination;
};
export type SurgeProfileDefinition = Omit<SurgeProfileInput, "groups" | "rules" | "fallback"> & {
  readonly groups: readonly ProxyGroupDefinition[];
  readonly routes: readonly RouteDefinition[];
  readonly fallback: Destination;
};
export class ProfileDefinitionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProfileDefinitionError";
  }
}
const fail = (code: string): never => {
  throw new ProfileDefinitionError(code);
};

/** Inspect descriptors before any caller spreads or reads input fields. Shared DAGs are legal. */
function inspect(root: unknown): void {
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
  inspect(input);
  return snapshot(input);
}
function exact(value: object, keys: readonly string[]): void {
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
  inspect(input);
  exact(input, ["id", "name", "algorithm", "members", "url", "intervalSeconds", "timeoutSeconds"]);
  if (!input.algorithm || !["select", "surge-smart"].includes(input.algorithm.type))
    fail("UNSUPPORTED_GROUP_ALGORITHM");
  exact(input.algorithm, ["type"]);
  if (!Array.isArray(input.members)) fail("INVALID_GROUP_DEFINITION");
  return {
    ...input,
    type: "proxy-group",
    algorithm: { ...input.algorithm },
    members: [...input.members],
  };
}
export function defineRoute(input: Omit<RouteDefinition, "type">): RouteDefinition {
  inspect(input);
  exact(input, ["when", "to"]);
  return { ...input, type: "route" };
}
export function defineRoutes(input: {
  readonly when: readonly SurgeCondition[];
  readonly to: Destination;
}): RouteDefinition[] {
  inspect(input);
  exact(input, ["when", "to"]);
  if (!Array.isArray(input.when)) fail("INVALID_ROUTE_DEFINITION");
  return input.when.map((when) => ({ type: "route", when, to: input.to }));
}
export function selectProxies(
  nodes: readonly ProxyNode[],
  query: {
    ids?: readonly string[];
    regions?: readonly string[];
    providers?: readonly string[];
    tags?: readonly string[];
  } = {},
): ProxyNode[] {
  inspect({ nodes, query });
  exact(query, ["ids", "regions", "providers", "tags"]);
  if (!Array.isArray(nodes) || nodes.some((node) => !node || typeof node !== "object"))
    fail("DEFINITION_NOT_DATA");
  for (const values of Object.values(query))
    if (values !== undefined && !Array.isArray(values)) fail("DEFINITION_NOT_DATA");
  return nodes.filter(
    (node) =>
      (!query.ids || query.ids.includes(node.id)) &&
      (!query.regions || (node.region !== undefined && query.regions.includes(node.region))) &&
      (!query.providers ||
        (node.provider !== undefined && query.providers.includes(node.provider))) &&
      (!query.tags || query.tags.every((tag) => node.tags?.includes(tag))),
  );
}
export function defineSurgeProfile(input: SurgeProfileDefinition): SurgeProfileInput {
  inspect(input);
  exact(input, [
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
  const registry = new Map<string, Destination>();
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
  function lower(destination: Destination): SurgePolicy {
    if (!destination || typeof destination !== "object") fail("INVALID_DESTINATION");
    if ("builtin" in destination) {
      exact(destination, ["builtin"]);
      if (!Object.values(outbound).some((value) => value.builtin === destination.builtin))
        fail("INVALID_DESTINATION");
      return { builtin: destination.builtin };
    }
    if (registry.get(destination.id) !== destination) fail("UNREGISTERED_DESTINATION_INSTANCE");
    return { ref: destination.id };
  }
  const groups = input.groups.map((definition) => {
    exact(definition, [
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
    exact(definition.algorithm, ["type"]);
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
    exact(definition, ["type", "when", "to"]);
    if (definition.type !== "route") fail("INVALID_ROUTE_DEFINITION");
    return { when: definition.when, then: lower(definition.to) };
  });
  const { routes: _routes, groups: _groups, fallback, ...rest } = input;
  return snapshot({ ...rest, names, groups, rules, fallback: lower(fallback) });
}

type Options = { readonly noResolve?: boolean; readonly extendedMatching?: boolean };
function condition<T extends SurgeCondition>(value: T): T {
  inspect(value);
  return value;
}
function atom(
  type:
    | "domain"
    | "domainSuffix"
    | "ipCidr"
    | "ipCidr6"
    | "sourceIp"
    | "processName"
    | "macAddress",
) {
  return (value: string, options: Options = {}): SurgeCondition => {
    inspect(options);
    return condition({ ...options, type, value });
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
    inspect(options);
    return condition({ ...options, type: "network", value });
  },
  port: (from: number, to?: number, options: Options = {}): SurgeCondition => {
    inspect(options);
    return condition({ ...options, type: "port", from, ...(to === undefined ? {} : { to }) });
  },
  sourcePort: (from: number, to?: number, options: Options = {}): SurgeCondition => {
    inspect(options);
    return condition({ ...options, type: "sourcePort", from, ...(to === undefined ? {} : { to }) });
  },
  all: (conditions: readonly SurgeCondition[], options: Options = {}): SurgeCondition => {
    inspect({ conditions, options });
    return condition({ ...options, type: "all", conditions: [...conditions] });
  },
  any: (conditions: readonly SurgeCondition[], options: Options = {}): SurgeCondition => {
    inspect({ conditions, options });
    return condition({ ...options, type: "any", conditions: [...conditions] });
  },
  not: (value: SurgeCondition, options: Options = {}): SurgeCondition => {
    inspect({ value, options });
    return condition({ ...options, type: "not", condition: value });
  },
  ruleSet: (
    options: Omit<Extract<SurgeCondition, { type: "ruleSet" }>, "type">,
  ): SurgeCondition => {
    inspect(options);
    return condition({ ...options, type: "ruleSet" });
  },
};
