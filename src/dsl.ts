// @concord-file
// @concord-implements docs/feature/rule-composition/README.md
import { processNameSchema } from "./schema.js";
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
export const match = {
  processName: (value: string): Match => {
    if (!processNameSchema.safeParse(value).success) throw new Error("INVALID_PROCESS_NAME");
    return { type: "processName", value };
  },
  ruleSet: (set: NamedRuleSet): Match => set,
  domain: (value: string): Match => ({ type: "domain", value }),
  domainSuffix: (value: string): Match => ({ type: "domainSuffix", value }),
  ipCidr: (value: string): Match => ({ type: "ipCidr", value }),
  sourceIp: (value: string): Match => ({ type: "sourceIp", value }),
  port: (from: number, to = from): Match => ({ type: "port", from, to }),
  sourcePort: (from: number, to = from): Match => ({ type: "sourcePort", from, to }),
  network: (value: Network): Match => ({ type: "network", value }),
  all: (...conditions: readonly Match[]): Match => ({ type: "all", conditions }),
  any: (...conditions: readonly Match[]): Match => ({ type: "any", conditions }),
  not: (condition: Match): Match => ({ type: "not", condition }),
};
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
  ruleSet: (
    options: Omit<Extract<NativeRuleSet, { engine: "surge" }>, "type" | "engine" | "format"> & {
      format?: "rule-set" | "domain-set";
    },
  ): NativeRuleSet => ({ format: "rule-set", ...options, type: "nativeRuleSet", engine: "surge" }),
};
export const mihomo = {
  ruleProvider: (
    options: Omit<Extract<NativeRuleSet, { engine: "mihomo" }>, "type" | "engine">,
  ): NativeRuleSet => ({ ...options, type: "nativeRuleSet", engine: "mihomo" }),
};

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
  ruleSet: (
    options: Omit<Extract<NativeRuleSet, { engine: "sing-box" }>, "type" | "engine">,
  ): NativeRuleSet => ({ ...options, type: "nativeRuleSet", engine: "sing-box" }),
  tailscale: (options: Omit<TailscaleEndpoint, "type">): TailscaleEndpoint => ({
    ...options,
    type: "sing-box-tailscale",
  }),
};
