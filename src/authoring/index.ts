// @concord-file
// @concord-implements docs/feature/profile/library/README.md
export { defineProfile } from "./profile.js";
export { defineProxyGroup, defineRoutes, outbound } from "./resources.js";
export { proxy, group, match, surge, singbox, dnsRule, ruleSet } from "./constructors.js";
export { defineSecrets } from "./secret-inputs.js";
export { proxyId } from "./proxy-id.js";
export { defineBuild } from "./build.js";
export { ProfileDefinitionError } from "../model/definitions.js";
export type { ProxyBuilder } from "./proxy-builder.js";
export type {
  Profile,
  ProfileDefinition,
  Target,
  Exit,
  Route,
  Condition,
  RuleSet,
  Fragments,
  ProxyNode,
  ProxyGroup,
  SurgeTunnel,
  SingBoxEndpoint,
  Secrets,
  SecretRef,
} from "../model/profile-types.js";
export type { GroupAlgorithm, DnsRule } from "../model/types.js";
export type { SurgeGeneral, SurgeHost } from "../model/surge-schema.js";
import type { ProxyNode } from "../model/profile-types.js";
export type HttpNode = Extract<ProxyNode, { type: "http" }>;
export type TrojanNode = Extract<ProxyNode, { type: "trojan" }>;
export type AnyTLSNode = Extract<ProxyNode, { type: "anytls" }>;
export type Hysteria2Node = Extract<ProxyNode, { type: "hysteria2" }>;
export type ShadowsocksNode = Extract<ProxyNode, { type: "shadowsocks" }>;
export type VMessNode = Extract<ProxyNode, { type: "vmess" }>;
export type VLESSNode = Extract<ProxyNode, { type: "vless" }>;

export type { RouteCase, RouteRequest, Assumptions } from "../model/routing-types.js";
