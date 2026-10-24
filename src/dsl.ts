// @concord-file
// @concord-implements docs/feature/rule-composition/README.md
import { createHash } from "node:crypto";
import type { ProfileCondition, ProfileDestination } from "./profile.js";
import {
  exactDefinition,
  inspectDefinition,
  snapshotDefinition,
  ProfileDefinitionError,
  type RouteDefinition,
} from "./surge-definitions.js";
import { nativeRuleSetSchema, processNameSchema } from "./schema.js";
import { surgeConfig } from "./profile.js";
import { surgeMatch } from "./surge-definitions.js";
import { proxyBuilder } from "./proxy-builder.js";
import type {
  NamedRuleSet,
  NativeRuleSet,
  Action,
  Block,
  Config,
  Entry,
  Match,
  Network,
  Policy,
  ProxyNode,
  Rule,
  Secret,
  Slot,
  Use,
  GroupAlgorithm,
  Strategy,
  StrategyDefinition,
  TailscaleEndpoint,
} from "./types.js";

export const ruleSet = (definition: Omit<NamedRuleSet, "type">): NamedRuleSet => ({
  ...definition,
  type: "ruleSet",
});
type DomainOptions = { readonly extendedMatching?: boolean };
type IpOptions = { readonly noResolve?: boolean };
function options<T extends DomainOptions | IpOptions>(value: T, keys: readonly string[]): T {
  inspectDefinition(value);
  exactDefinition(value, keys);
  if (Object.values(value).some((v) => v !== undefined && typeof v !== "boolean"))
    throw new ProfileDefinitionError("INVALID_MATCH_OPTIONS");
  return { ...value };
}
export const match = {
  processName: (value: string): { readonly type: "processName"; readonly value: string } => {
    if (!processNameSchema.safeParse(value).success) throw new Error("INVALID_PROCESS_NAME");
    return { type: "processName", value };
  },
  ruleSet: (set: NamedRuleSet): NamedRuleSet => set,
  domain: (value: string, opts: DomainOptions = {}) => ({
    type: "domain" as const,
    value,
    ...options(opts, ["extendedMatching"]),
  }),
  domainSuffix: (value: string, opts: DomainOptions = {}) => ({
    type: "domainSuffix" as const,
    value,
    ...options(opts, ["extendedMatching"]),
  }),
  ipCidr: (value: string, opts: IpOptions = {}) => ({
    type: "ipCidr" as const,
    value,
    ...options(opts, ["noResolve"]),
  }),
  sourceIp: (value: string) => ({ type: "sourceIp" as const, value }),
  port: (from: number, to = from) => ({ type: "port" as const, from, to }),
  sourcePort: (from: number, to = from) => ({ type: "sourcePort" as const, from, to }),
  network: (value: Network) => ({ type: "network" as const, value }),
  all: <const C extends readonly ProfileCondition[]>(...conditions: C) => ({
    type: "all" as const,
    conditions,
  }),
  any: <const C extends readonly ProfileCondition[]>(...conditions: C) => ({
    type: "any" as const,
    conditions,
  }),
  not: <const C extends ProfileCondition>(condition: C) => ({ type: "not" as const, condition }),
};
type NativeFor<E extends NativeRuleSet["engine"]> = Extract<NativeRuleSet, { engine: E }>;
type NativeInput<E extends NativeRuleSet["engine"]> = Omit<
  NativeFor<E>,
  "type" | "engine" | "id"
> & { readonly id?: string };
type SurgeSetInput = Omit<NativeInput<"surge">, "format"> & {
  readonly format?: "rule-set" | "domain-set";
};
type SetInput<E extends NativeRuleSet["engine"]> = E extends "surge"
  ? SurgeSetInput
  : NativeInput<E>;
// @concord-code
// @concord-implements docs/feature/target-compilation/match-options.md
function nativeConstructor<E extends NativeRuleSet["engine"]>(engine: E) {
  function construct(input: SetInput<E> & { readonly to: ProfileDestination }): RouteDefinition;
  function construct(input: SetInput<E>): NativeFor<E>;
  function construct(value: unknown): RouteDefinition | NativeRuleSet {
    inspectDefinition(value);
    if (!value || typeof value !== "object")
      throw new ProfileDefinitionError("INVALID_NATIVE_RULESET");
    exactDefinition(value, [
      "id",
      "url",
      "format",
      "intervalSeconds",
      "noResolve",
      "extendedMatching",
      "behavior",
      "to",
    ]);
    const input = value as SetInput<E> & { readonly to?: ProfileDestination };
    const { to, ...resource } = input;
    exactDefinition(resource, [
      "id",
      "url",
      "format",
      "intervalSeconds",
      ...(engine === "surge"
        ? ["noResolve", "extendedMatching"]
        : engine === "mihomo"
          ? ["behavior"]
          : []),
    ]);
    const parsed = nativeRuleSetSchema.safeParse({
      ...(engine === "surge" ? { format: "rule-set" } : {}),
      ...resource,
      id: resource.id ?? "ruleset-pending",
      type: "nativeRuleSet",
      engine,
    });
    if (!parsed.success) throw new ProfileDefinitionError("INVALID_NATIVE_RULESET");
    const { id: _id, type: _type, ...fields } = parsed.data;
    const id =
      resource.id ??
      `ruleset-${createHash("sha256")
        .update(
          JSON.stringify(
            Object.entries(fields)
              .filter(([, value]) => value !== undefined)
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        )
        .digest("hex")
        .slice(0, 16)}`;
    const when = snapshotDefinition({ ...parsed.data, id }) as NativeFor<E>;
    if (Object.hasOwn(input, "to")) {
      if (to === undefined) throw new ProfileDefinitionError("INVALID_DESTINATION");
      return { type: "route", when, to };
    }
    return when;
  }
  return construct;
}
const surgeRuleSet = nativeConstructor("surge");
const mihomoRuleSet = nativeConstructor("mihomo");
const singboxRuleSet = nativeConstructor("sing-box");
export const direct = (): Action => ({ type: "direct" });
export const reject = (): Action => ({ type: "reject" });
export const route = (to: string): Action => ({ type: "route", to });
/** An exit parameter declared by policy.exits and resolved by use.bindings. */
export const slot = <const S extends string>(name: S): Slot<S> => ({ type: "slot", name });
export const secret = (name: string): Secret => ({ type: "env", name });
export const rule = <const S extends string = never>(
  id: string,
  when: Match,
  then: Action | Slot<S>,
): Rule<S> => ({
  type: "rule",
  id,
  when,
  then,
});
export const block = <const S extends string = never>(
  id: string,
  rules: readonly Entry<S>[],
  when?: Match,
): Block<S> => ({
  type: "block",
  id,
  rules,
  ...(when ? { when } : {}),
});
type CheckedEntries<S extends string, R extends readonly Entry[]> = R &
  (string extends (R[number] extends Entry<infer Used> ? Used : never)
    ? unknown
    : readonly Entry<S>[]);
export const policy = <
  const S extends string,
  const R extends readonly Entry[] = readonly Entry<S>[],
>(
  definition: Omit<Policy<S>, "type" | "rules"> & { readonly rules: CheckedEntries<NoInfer<S>, R> },
): Policy<S> => ({
  type: "policy",
  ...definition,
});
export const use = <S extends string, const B extends Record<NoInfer<S>, Action | Slot>>(
  definition: Policy<S>,
  options: { id: string; bindings: B & Record<Exclude<keyof B, S>, never> },
): Use<Extract<B[keyof B], Slot>["name"]> => ({
  type: "use",
  id: options.id,
  policy: definition,
  bindings: options.bindings,
});
export const sequence = <const S extends string = never>(
  ...parts: readonly (Entry<S> | readonly Entry<S>[])[]
): Entry<S>[] => parts.flatMap((part) => (Array.isArray(part) ? part : [part])) as Entry<S>[];
export const defineConfig = <const T extends Config>(
  config: T & {
    readonly targets: readonly (Config["targets"][number] & {
      readonly program: string extends NoInfer<T>["targets"][number]["program"]
        ? string
        : keyof NoInfer<T>["programs"] & string;
    })[];
    readonly cases?: readonly (NonNullable<Config["cases"]>[number] & {
      readonly program: string extends NonNullable<NoInfer<T>["cases"]>[number]["program"]
        ? string
        : keyof NoInfer<T>["programs"] & string;
    })[];
  },
): T => config;

/** Filtering is stable: catalogue order determines initial selector order. */
// @concord-code
// @concord-implements docs/feature/rule-composition/use-case/select-resources.md
export function selectNodes(
  nodes: readonly ProxyNode[],
  query: {
    regions?: readonly string[];
    providers?: readonly string[];
    tags?: readonly string[];
  } = {},
): string[] {
  return nodes
    .filter(
      (node) =>
        (!query.regions || (node.region !== undefined && query.regions.includes(node.region))) &&
        (!query.providers ||
          (node.provider !== undefined && query.providers.includes(node.provider))) &&
        (!query.tags || query.tags.every((tag) => node.tags?.includes(tag))),
    )
    .map((node) => node.id);
}

/** A shared strategy declares an algorithm or explicitly selects native implementations. */
export const strategy = (definition: StrategyDefinition): Strategy => ({
  type: "strategy",
  ...definition,
});
export const group = {
  auto: (): { readonly type: "auto" } => ({ type: "auto" }),
  select: (): Extract<GroupAlgorithm, { type: "select" }> => ({ type: "select" }),
  urltest: (
    options: Omit<Extract<GroupAlgorithm, { type: "urltest" }>, "type">,
  ): Extract<GroupAlgorithm, { type: "urltest" }> => ({ type: "urltest", ...options }),
};
export const surge = {
  config: surgeConfig,
  match: surgeMatch,
  smart: (): Extract<GroupAlgorithm, { type: "surge-smart" }> => ({ type: "surge-smart" }),
  ruleSet: surgeRuleSet,
};
export const mihomo = { ruleSet: mihomoRuleSet, ruleProvider: mihomoRuleSet };

/** Protocol constructors keep credentials and options specific to their protocol. */
function nodeConstructor<T extends ProxyNode["type"]>(type: T) {
  return (
    options: Omit<Extract<ProxyNode, { type: T }>, "type">,
  ): Extract<ProxyNode, { type: T }> => ({ ...options, type }) as Extract<ProxyNode, { type: T }>;
}
export const proxy = {
  builder: proxyBuilder,
  http: nodeConstructor("http"),
  trojan: nodeConstructor("trojan"),
  anytls: nodeConstructor("anytls"),
  shadowsocks: nodeConstructor("shadowsocks"),
  vmess: nodeConstructor("vmess"),
  vless: nodeConstructor("vless"),
};
export const singbox = {
  ruleSet: singboxRuleSet,
  tailscale: (options: Omit<TailscaleEndpoint, "type">): TailscaleEndpoint => ({
    ...options,
    type: "sing-box-tailscale",
  }),
};
