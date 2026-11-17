// @concord-file
// @concord-implements docs/feature/profile/README.md
import { domainIdentityFields } from "../model/match-identity.js";
import { dnsRulesSchema } from "../model/dns.js";
import type {
  DnsRule,
  Network,
  NativeRuleSet,
  GroupAlgorithm,
  ProxyNode,
  Secret,
  TailscaleEndpoint,
} from "../model/types.js";
import { createHash } from "node:crypto";
import type { ProfileCondition, ProfileDestination } from "./profile.js";
import {
  exactDefinition,
  inspectDefinition,
  snapshotDefinition,
  ProfileDefinitionError,
} from "../model/definitions.js";
import { nativeRuleSetSchema, processNameSchema } from "../model/schema.js";
import { surgeMatch } from "./surge-match.js";
import type { RouteDefinition } from "../model/profile-types.js";
import { proxyBuilder } from "./proxy-builder.js";

export function dnsRule(pattern: string, server: string): DnsRule;
export function dnsRule(patterns: readonly string[], server: string): DnsRule[];
// @concord-code
// @concord-implements docs/feature/profile/library/conditions.md
export function dnsRule(pattern: string | readonly string[], server: string): DnsRule | DnsRule[] {
  inspectDefinition({ pattern, server });
  const batch = Array.isArray(pattern);
  const patterns = batch ? pattern : [pattern];
  if (patterns.length > 2000) throw new ProfileDefinitionError("INVALID_DNS_RULE");
  const checked = dnsRulesSchema.safeParse(patterns.map((value) => ({ pattern: value, server })));
  if (!checked.success) throw new ProfileDefinitionError("INVALID_DNS_RULE");
  return batch ? checked.data : checked.data[0]!;
}

type DomainOptions = { readonly includeSniffed?: boolean };
type IpOptions = { readonly noResolve?: boolean };
function options<T extends DomainOptions | IpOptions>(value: T, keys: readonly string[]): T {
  inspectDefinition(value);
  exactDefinition(value, keys);
  if (Object.values(value).some((v) => v !== undefined && typeof v !== "boolean"))
    throw new ProfileDefinitionError("INVALID_MATCH_OPTIONS");
  return snapshotDefinition(value);
}
export const match = {
  processName: (value: string): { readonly type: "processName"; readonly value: string } => {
    if (!processNameSchema.safeParse(value).success) throw new Error("INVALID_PROCESS_NAME");
    return { type: "processName", value };
  },
  domain: (value: string, opts: DomainOptions = {}) => ({
    type: "domain" as const,
    value,
    ...options(opts, ["includeSniffed"]),
  }),
  domainSuffix: (value: string, opts: DomainOptions = {}) => ({
    type: "domainSuffix" as const,
    value,
    ...options(opts, ["includeSniffed"]),
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
// @concord-implements docs/feature/profile/library/conditions.md
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
      "includeSniffed",
      "resolve",
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
        ? ["noResolve", "includeSniffed"]
        : engine === "mihomo"
          ? ["behavior"]
          : ["resolve"]),
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
        .update(JSON.stringify(domainIdentityFields(fields)))
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
export const secret = (name: string): Secret => ({ type: "env", name });
export const group = {
  auto: (): { readonly type: "auto" } => ({ type: "auto" }),
  select: (): Extract<GroupAlgorithm, { type: "select" }> => ({ type: "select" }),
  urltest: (
    options: Omit<Extract<GroupAlgorithm, { type: "urltest" }>, "type">,
  ): Extract<GroupAlgorithm, { type: "urltest" }> => ({ type: "urltest", ...options }),
};
export const surge = {
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
  hysteria2: nodeConstructor("hysteria2"),
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
