// @concord-file
// @concord-implements docs/feature/profile/library/README.md
export { defineProfile } from "./profile.js";
export type {
  Profile,
  ProfileDefinition,
  ProfileProxy,
  Fragments,
  ProfileCondition,
  ProfileDestination,
  SurgeConfig,
  DeepReadonly,
  ProxyGroupDefinition,
  RouteDefinition,
} from "../model/profile-types.js";
export { defineProxyGroup, defineRoutes, outbound } from "./resources.js";
export { ProfileDefinitionError } from "../model/definitions.js";
export { proxy, group, match, surge, singbox, mihomo, secret, dnsRule } from "./constructors.js";
export { proxyId } from "./proxy-id.js";
export type { ProxyBuilder } from "./proxy-builder.js";
export { defineBuild } from "./build.js";
export { secrets, type SecretsInput } from "./secret-inputs.js";
export type {
  SurgeCondition,
  SurgeGeneral,
  SurgeHost,
  SurgeTunnel,
} from "../model/surge-schema.js";
export type {
  ProxyNode,
  TrojanNode,
  AnyTLSNode,
  Hysteria2Node,
  HttpNode,
  ShadowsocksNode,
  VMessNode,
  VLESSNode,
  ProxyTLS,
  WebSocketTransport,
  SurgeProxyOptions,
  Secret,
  GroupAlgorithm,
  PortableAlgorithm,
  Target,
  DnsRule,
  Tun,
  TailscaleEndpoint,
  Diagnostic,
  Network,
  Engine,
  NativeRuleSet,
} from "../model/types.js";
