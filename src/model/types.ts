// @concord-file
// @concord-implements docs/feature/profile/README.md
export type Network = "tcp" | "udp";
export type NativeRuleSet = {
  readonly type: "nativeRuleSet";
  readonly id: string;
  readonly url: string;
} & (
  | {
      readonly engine: "surge";
      readonly format: "rule-set" | "domain-set";
      readonly intervalSeconds?: number;
      readonly noResolve?: boolean;
      readonly includeSniffed?: boolean;
    }
  | {
      readonly engine: "sing-box";
      readonly format: "source" | "binary";
      readonly intervalSeconds: number;
      readonly resolve?: boolean;
    }
  | {
      readonly engine: "mihomo";
      readonly format: "yaml" | "text";
      readonly behavior: "domain" | "ipcidr" | "classical";
      readonly intervalSeconds: number;
    }
);
export type Match =
  | NativeRuleSet
  | {
      readonly type: "domain" | "domainSuffix";
      readonly includeSniffed?: boolean;
      readonly value: string;
    }
  | { readonly type: "ipCidr"; readonly value: string; readonly noResolve?: boolean }
  | {
      readonly type: "sourceIp" | "processName";
      readonly value: string;
    }
  | { readonly type: "port" | "sourcePort"; readonly from: number; readonly to: number }
  | { readonly type: "network"; readonly value: Network }
  | { readonly type: "all" | "any"; readonly conditions: readonly Match[] }
  | { readonly type: "not"; readonly condition: Match };
export type Action =
  | { readonly type: "direct" | "reject" }
  | { readonly type: "route"; readonly to: string };
export type Secret = { readonly type: "env"; readonly name: string };
export type ProxyBase = {
  readonly id: string;
  readonly server: string;
  readonly port: number;
  readonly via?: string;
  readonly tcpFastOpen?: boolean;
};
export type ProxyTLS = {
  readonly serverName: string;
  readonly alpn?: readonly string[];
  readonly skipCertVerify?: boolean;
};
export type SurgeProxyOptions = {
  readonly udpRelay?: boolean;
  readonly blockQuic?: "auto" | "on" | "off";
};
type SurgeAutomaticUdpOptions = Omit<SurgeProxyOptions, "udpRelay"> & {
  readonly udpRelay?: true;
};
export type WebSocketTransport = {
  readonly type: "ws";
  readonly path: string;
  readonly host?: string;
};
export type TrojanNode = ProxyBase & {
  readonly type: "trojan";
  readonly password: Secret;
  readonly serverName?: string;
  readonly skipCertVerify?: boolean;
  readonly surge?: SurgeAutomaticUdpOptions;
};
export type AnyTLSNode = ProxyBase & {
  readonly type: "anytls";
  readonly password: Secret;
  readonly serverName?: string;
  readonly skipCertVerify?: boolean;
  readonly surge?: SurgeAutomaticUdpOptions;
};
export type Hysteria2Node = Omit<ProxyBase, "tcpFastOpen"> & {
  readonly type: "hysteria2";
  readonly tcpFastOpen?: never;
  readonly password: Secret;
  readonly serverName?: string;
  readonly skipCertVerify?: boolean;
  readonly portHopping?: string;
  readonly portHoppingInterval?: number;
};
export type HttpNode = ProxyBase & {
  readonly type: "http";
  readonly serverName?: never;
  readonly password: Secret;
  readonly username?: Secret;
};
export type ShadowsocksNode = ProxyBase & {
  readonly type: "shadowsocks";
  readonly method: "aes-128-gcm" | "aes-256-gcm" | "chacha20-ietf-poly1305";
  readonly password: Secret;
  readonly surge?: SurgeProxyOptions;
};
export type VMessNode = ProxyBase & {
  readonly type: "vmess";
  readonly uuid: Secret;
  readonly tls?: ProxyTLS;
  readonly transport?: WebSocketTransport;
  readonly surge?: Pick<SurgeProxyOptions, "blockQuic">;
};
export type VLESSNode = ProxyBase & {
  readonly type: "vless";
  readonly uuid: Secret;
  readonly tls?: ProxyTLS;
  readonly transport?: WebSocketTransport;
  readonly flow?: "xtls-rprx-vision";
  readonly packetEncoding?: "xudp" | "packetaddr";
  readonly reality?: { readonly publicKey: string; readonly shortId: string };
  readonly utlsFingerprint?: "chrome";
};
export type ProxyNode =
  | TrojanNode
  | AnyTLSNode
  | Hysteria2Node
  | HttpNode
  | ShadowsocksNode
  | VMessNode
  | VLESSNode;
export type TailscaleEndpoint = {
  readonly type: "sing-box-tailscale";
  readonly id: string;
  readonly hostname: string;
  readonly stateDirectory: string;
  readonly acceptRoutes: boolean;
  readonly bootstrapResolver: string;
  readonly authKey?: Secret;
  readonly exitNode?: string;
  readonly exitNodeAllowLanAccess?: boolean;
};
export type GroupAlgorithm =
  | { readonly type: "auto" }
  | { readonly type: "select" }
  | { readonly type: "surge-smart" }
  | {
      readonly type: "urltest";
      readonly url: string;
      readonly intervalSeconds?: number;
      readonly toleranceMs?: number;
    };
export type PortableAlgorithm =
  | { readonly type: "auto" }
  | Extract<GroupAlgorithm, { readonly type: "select" | "urltest" }>;
export type ConcreteGroup =
  | { readonly id: string; readonly type: "select"; readonly members: readonly string[] }
  | { readonly id: string; readonly type: "smart"; readonly members: readonly string[] }
  | { readonly id: string; readonly type: "surge-smart"; readonly members: readonly string[] }
  | {
      readonly id: string;
      readonly type: "urltest";
      readonly members: readonly string[];
      readonly url: string;
      readonly intervalSeconds?: number;
      readonly toleranceMs?: number;
    };

export type Engine = "surge" | "sing-box" | "mihomo" | "stash";
export type DnsRule<Server = string> = { readonly pattern: string; readonly server: Server };
export type TailscaleDnsServer<Endpoint> = {
  readonly endpoint: Endpoint;
  readonly acceptDefaultResolvers?: boolean;
};
export type Tun = {
  readonly address: readonly string[];
  readonly stack: "system" | "gvisor" | "mixed";
  readonly autoRoute: boolean;
  readonly strictRoute: boolean;
  readonly dnsMode: "disabled" | "native" | "hijack";
  readonly routeExcludeAddress?: readonly string[];
};
export type Target = {
  readonly id: string;
  readonly engine: Engine;
  readonly platform: "macos" | "linux" | "ios";
  readonly version: string;
  readonly mode?: "fragment" | "standalone";
};
export type Request = {
  readonly network: Network;
  readonly domain?: string;
  readonly tlsSni?: string;
  readonly httpHost?: string;
  readonly ip?: string;
  readonly sourceIp?: string;
  readonly processName?: string;
  readonly port?: number;
  readonly sourcePort?: number;
};
export type Diagnostic = {
  readonly profile?: string;
  readonly origin?: import("./identity.js").Origin;
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly target?: string;
};
export type ProfileDiagnostic = Omit<Diagnostic, "target" | "profile"> & {
  readonly profile: string;
};
export type ExpandedRule = {
  readonly id: string;
  readonly when: Match;
  readonly then: Action;
  readonly origin: readonly string[];
};

export type NormalizedProfile = {
  readonly target: Target;
  readonly nodes: readonly ProxyNode[];
  readonly endpoints: readonly TailscaleEndpoint[];
  readonly groups: readonly ConcreteGroup[];
  readonly rules: readonly ExpandedRule[];
  readonly fallback: Action;
  readonly listener?: { readonly port: number; readonly resolver: string };
  readonly dns?: readonly DnsRule<string | TailscaleDnsServer<string>>[];
  readonly tun?: Tun;
  readonly domainMatching?: "prefer-sniffed";
  readonly serverAliases?: Readonly<Record<string, string>>;
  readonly cacheFile?: boolean;
  readonly unsupportedUdp?: "reject";
};
export type EnginePlan = {
  readonly names?: ReadonlyMap<string, string>;
  readonly model: NormalizedProfile;
  readonly nativeRuleSets: readonly NativeRuleSet[];
};
