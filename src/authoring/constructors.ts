import { dnsRulesSchema } from "../model/dns.js";
import {
  nodeSchema,
  endpointSchema,
  matchSchema,
  nativeRuleSetSchema,
  idSchema,
} from "../model/schema.js";
import { tunnelSchema } from "../model/surge-schema.js";
import {
  exactDefinition,
  inspectDefinition,
  ProfileDefinitionError,
} from "../model/definitions.js";
import type { Network, GroupAlgorithm } from "../model/types.js";
import type { SDK } from "../model/identity.js";
import type {
  ProxyNode,
  SurgeTunnel,
  SingBoxEndpoint,
  RuleSet,
  ExternalRuleSet,
  Condition,
  Fragments,
} from "../model/profile-types.js";
import type { DnsRule } from "../model/types.js";
import { created, flatten, parsed, requireKind, inspectRecord } from "./data.js";
import { proxyBuilder } from "./proxy-builder.js";
import { surgeMatch } from "./surge-match.js";
export function dnsRule(pattern: string, server: string): DnsRule;
export function dnsRule(pattern: readonly string[], server: string): DnsRule[];
// @concord-code
// @concord-implements docs/feature/profile/library/conditions.md#dns-规则
export function dnsRule(pattern: string | readonly string[], server: string): DnsRule | DnsRule[] {
  const batch = Array.isArray(pattern);
  const result = parsed(
    dnsRulesSchema,
    (batch ? pattern : [pattern]).map((p) => ({ pattern: p, server })),
  ).map((item) => created(item, "dns"));
  return batch ? (Object.freeze(result) as unknown as DnsRule[]) : result[0]!;
}
type DomainOptions = { readonly includeSniffed?: boolean };
type IpOptions = { readonly noResolve?: boolean };
function atom<
  K extends "domain" | "domainSuffix" | "ipCidr" | "sourceIp" | "processName",
  O extends object,
>(type: K, keys: readonly string[]) {
  function construct(value: string, options?: O): { readonly type: K; readonly value: string } & O;
  function construct(
    value: readonly string[],
    options?: O,
  ): ({ readonly type: K; readonly value: string } & O)[];
  function construct(
    value: string | readonly string[],
    options: O = {} as O,
  ):
    | ({ readonly type: K; readonly value: string } & O)
    | ({ readonly type: K; readonly value: string } & O)[] {
    inspectDefinition({ value, options });
    exactDefinition(options, keys);
    const one = (v: string) =>
      created(parsed(matchSchema, { type, value: v, ...options }), "condition") as unknown as {
        readonly type: K;
        readonly value: string;
      } & O;
    return Array.isArray(value)
      ? (Object.freeze(value.map(one)) as unknown as unknown as ({
          readonly type: K;
          readonly value: string;
        } & O)[])
      : one(value as string);
  }
  return construct;
}
function logical(type: "all" | "any", fragments: Fragments<Condition>) {
  const conditions = flatten(fragments);
  for (const c of conditions) requireKind(c, ["condition", "ruleSet"]);
  if (!conditions.length) throw new ProfileDefinitionError("EMPTY_FRAGMENT");
  return created({ type, conditions }, "condition");
}
export const match = {
  domain: atom<"domain", DomainOptions>("domain", ["includeSniffed"]),
  domainSuffix: atom<"domainSuffix", DomainOptions>("domainSuffix", ["includeSniffed"]),
  ipCidr: atom<"ipCidr", IpOptions>("ipCidr", ["noResolve"]),
  sourceIp: atom<"sourceIp", Record<string, never>>("sourceIp", []),
  processName: atom<"processName", Record<string, never>>("processName", []),
  port: (from: number, to = from) =>
    created(parsed(matchSchema, { type: "port", from, to }), "condition") as Extract<
      Condition,
      { type: "port" | "sourcePort" }
    >,
  sourcePort: (from: number, to = from) =>
    created(parsed(matchSchema, { type: "sourcePort", from, to }), "condition") as Extract<
      Condition,
      { type: "port" | "sourcePort" }
    >,
  network: (value: Network) =>
    created(parsed(matchSchema, { type: "network", value }), "condition") as Extract<
      Condition,
      { type: "network" }
    >,
  all: (...conditions: readonly Fragments<Condition>[]) => logical("all", conditions),
  any: (...conditions: readonly Fragments<Condition>[]) => logical("any", conditions),
  not: (condition: Condition) => {
    requireKind(condition, ["condition", "ruleSet"]);
    return created({ type: "not" as const, condition }, "condition");
  },
};
// @concord-code
// @concord-implements docs/feature/profile/library/README.md#规则集
export function ruleSet(input: Omit<ExternalRuleSet, "type" | keyof SDK<"ruleSet">>): RuleSet {
  inspectRecord(input);
  exactDefinition(input, ["id", "surge", "singBox", "mihomo"]);
  parsed(idSchema, input.id);
  let count = 0;
  for (const branch of ["surge", "singBox", "mihomo"] as const) {
    if (input[branch] === undefined) continue;
    count++;
    parsed(nativeRuleSetSchema, {
      type: "nativeRuleSet",
      id: input.id,
      engine: branch === "singBox" ? "sing-box" : branch,
      ...(branch === "surge" ? { format: "rule-set" } : {}),
      ...input[branch],
    });
  }
  if (!count) throw new ProfileDefinitionError("INVALID_FIELD");
  return created({ ...input, type: "ruleSetSource" as const }, "ruleSet");
}
export const group = {
  auto: () => created({ type: "auto" as const }, "algorithm"),
  select: () => created({ type: "select" as const }, "algorithm"),
  urltest: (input: Omit<Extract<GroupAlgorithm, { type: "urltest" }>, "type">) => {
    inspectRecord(input);
    exactDefinition(input, ["url", "intervalSeconds", "toleranceMs"]);
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new ProfileDefinitionError("INVALID_FIELD");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      !Number.isInteger(input.intervalSeconds ?? 180) ||
      (input.intervalSeconds ?? 180) < 1 ||
      (input.intervalSeconds ?? 180) > 86400 ||
      !Number.isInteger(input.toleranceMs ?? 50) ||
      (input.toleranceMs ?? 50) < 0 ||
      (input.toleranceMs ?? 50) > 60000
    )
      throw new ProfileDefinitionError("INVALID_FIELD");
    return created({ ...input, type: "urltest" as const }, "algorithm");
  },
};
type Input<T extends object> = Omit<T, "type" | keyof SDK<string>>;
// @concord-code
// @concord-implements docs/feature/profile/library/proxies.md#协议字段
function nodeConstructor<K extends ProxyNode["type"]>(type: K) {
  return (input: Input<Extract<ProxyNode, { type: K }>>): Extract<ProxyNode, { type: K }> => {
    inspectRecord(input);
    for (const key of ["password", "username", "uuid"] as const) {
      if (key in input) requireKind((input as unknown as Record<string, unknown>)[key], ["secret"]);
    }
    const { name, via, ...rest } = input;
    if (name !== undefined && typeof name !== "string")
      throw new ProfileDefinitionError("INVALID_FIELD", ["name"]);
    if (via !== undefined) requireKind(via, ["node", "group"]);
    parsed(nodeSchema, { ...rest, type, ...(via ? { via: via.id } : {}) });
    return created({ ...input, type }, "node") as Extract<ProxyNode, { type: K }>;
  };
}
export const proxy = {
  builder: proxyBuilder,
  http: nodeConstructor("http"),
  trojan: nodeConstructor("trojan"),
  anytls: nodeConstructor("anytls"),
  hysteria2: nodeConstructor("hysteria2"),
  shadowsocks: nodeConstructor("shadowsocks"),
  vmess: nodeConstructor("vmess"),
  vless: nodeConstructor("vless"),
};
// @concord-code
// @concord-implements docs/feature/profile/library/surge.md
function tunnel<K extends SurgeTunnel["type"]>(type: K) {
  return (input: Input<Extract<SurgeTunnel, { type: K }>>): Extract<SurgeTunnel, { type: K }> => {
    inspectRecord(input);
    const { name, ...rest } = input;
    if (name !== undefined && typeof name !== "string")
      throw new ProfileDefinitionError("INVALID_FIELD", ["name"]);
    parsed(tunnelSchema, { ...rest, type });
    return created({ ...input, type }, "tunnel") as Extract<SurgeTunnel, { type: K }>;
  };
}
export const surge = {
  match: surgeMatch,
  ruleSets: {
    lan: created(
      {
        type: "ruleSet" as const,
        id: "surge:lan" as const,
        format: "rule-set" as const,
        builtin: "LAN" as const,
      },
      "ruleSet",
    ),
    system: created(
      {
        type: "ruleSet" as const,
        id: "surge:system" as const,
        format: "rule-set" as const,
        builtin: "SYSTEM" as const,
      },
      "ruleSet",
    ),
  },
  smart: () => created({ type: "surge-smart" as const }, "algorithm"),
  tailscale: tunnel("tailscale"),
  wireguard: tunnel("wireguard"),
};
export const singbox = {
  tailscale: (input: Input<SingBoxEndpoint>): SingBoxEndpoint => {
    inspectRecord(input);
    const { name, ...rest } = input;
    if (name !== undefined && typeof name !== "string")
      throw new ProfileDefinitionError("INVALID_FIELD", ["name"]);
    parsed(endpointSchema, { ...rest, type: "sing-box-tailscale" });
    return created({ ...input, type: "sing-box-tailscale" as const }, "endpoint");
  },
};
