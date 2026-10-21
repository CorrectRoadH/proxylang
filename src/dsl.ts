// @concord-file
// @concord-implements docs/feature/rule-composition/README.md
import type {
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
  TailscaleEndpoint,
} from "./types.js";

export const match = {
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
export const slot = (name: string): Slot => ({ type: "slot", name });
export const secret = (name: string): Secret => ({ type: "env", name });
export const rule = (id: string, when: Match, then: Action | Slot): Rule => ({
  type: "rule",
  id,
  when,
  then,
});
export const block = (id: string, rules: readonly Entry[], when?: Match): Block => ({
  type: "block",
  id,
  rules,
  ...(when ? { when } : {}),
});
export const policy = <const S extends string>(definition: Omit<Policy<S>, "type">): Policy<S> => ({
  type: "policy",
  ...definition,
});
export const use = <S extends string>(
  definition: Policy<S>,
  options: { id: string; bindings: Record<NoInfer<S>, Action | Slot> },
): Use => ({ type: "use", id: options.id, policy: definition, bindings: options.bindings });
export const sequence = (...parts: readonly (Entry | readonly Entry[])[]): Entry[] =>
  parts.flatMap((part) => (Array.isArray(part) ? part : [part])) as Entry[];
export const defineConfig = <T extends Config>(config: T): T => config;

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

/** A shared strategy explicitly chooses an algorithm for each engine. */
export const strategy = (definition: Omit<Strategy, "type">): Strategy => ({
  type: "strategy",
  ...definition,
});
export const group = {
  select: (): GroupAlgorithm => ({ type: "select" }),
  urltest: (
    options: Omit<Extract<GroupAlgorithm, { type: "urltest" }>, "type">,
  ): GroupAlgorithm => ({ type: "urltest", ...options }),
};
export const surge = { smart: (): GroupAlgorithm => ({ type: "surge-smart" }) };

/** Protocol constructors keep credentials and options specific to their protocol. */
function nodeConstructor<T extends ProxyNode["type"]>(type: T) {
  return (
    options: Omit<Extract<ProxyNode, { type: T }>, "type">,
  ): Extract<ProxyNode, { type: T }> => ({ ...options, type }) as Extract<ProxyNode, { type: T }>;
}
export const proxy = {
  http: nodeConstructor("http"),
  trojan: nodeConstructor("trojan"),
  anytls: nodeConstructor("anytls"),
  shadowsocks: nodeConstructor("shadowsocks"),
  vmess: nodeConstructor("vmess"),
  vless: nodeConstructor("vless"),
};
export const singbox = {
  tailscale: (options: Omit<TailscaleEndpoint, "type">): TailscaleEndpoint => ({
    ...options,
    type: "sing-box-tailscale",
  }),
};
