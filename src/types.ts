// @concord-file
// @concord-implements docs/feature/rule-composition/README.md
export type Network = "tcp" | "udp";
export type NamedRuleSet = { readonly type: "ruleSet"; readonly id: string; readonly when: Match };
export type NativeRuleSet = {
  readonly type: "nativeRuleSet";
  readonly id: string;
  readonly url: string;
} & (
  | {
      readonly engine: "surge";
      readonly format: "rule-set" | "domain-set";
      readonly intervalSeconds?: number;
    }
  | {
      readonly engine: "sing-box";
      readonly format: "source" | "binary";
      readonly intervalSeconds: number;
    }
  | {
      readonly engine: "mihomo";
      readonly format: "yaml" | "text";
      readonly behavior: "domain" | "ipcidr" | "classical";
      readonly intervalSeconds: number;
    }
);
export type Match =
  | NamedRuleSet
  | NativeRuleSet
  | { readonly type: "domain" | "domainSuffix" | "ipCidr" | "sourceIp"; readonly value: string }
  | { readonly type: "port" | "sourcePort"; readonly from: number; readonly to: number }
  | { readonly type: "network"; readonly value: Network }
  | { readonly type: "all" | "any"; readonly conditions: readonly Match[] }
  | { readonly type: "not"; readonly condition: Match };
export type Action =
  | { readonly type: "direct" | "reject" }
  | { readonly type: "route"; readonly to: string };
export type Slot = { readonly type: "slot"; readonly name: string };
export type Rule = {
  readonly type: "rule";
  readonly id: string;
  readonly when: Match;
  readonly then: Action | Slot;
};
export type Block = {
  readonly type: "block";
  readonly id: string;
  readonly rules: readonly Entry[];
  readonly when?: Match;
};
export type Policy<S extends string = string> = {
  readonly type: "policy";
  readonly id: string;
  readonly exits: readonly S[];
  readonly rules: readonly Entry[];
};
export type Use = {
  readonly type: "use";
  readonly id: string;
  readonly policy: Policy;
  readonly bindings: Readonly<Record<string, Action | Slot>>;
};
export type Entry = Rule | Block | Use;
export type Secret = { readonly type: "env"; readonly name: string };
export type ProxyBase = {
  readonly id: string;
  readonly server: string;
  readonly port: number;
  readonly via?: string;
  readonly tcpFastOpen?: boolean;
  readonly label?: string;
  readonly region?: string;
  readonly provider?: string;
  readonly tags?: readonly string[];
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
};
export type ProxyNode =
  | TrojanNode
  | AnyTLSNode
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
  | { readonly type: "select" }
  | { readonly type: "surge-smart" }
  | {
      readonly type: "urltest";
      readonly url: string;
      readonly intervalSeconds?: number;
      readonly toleranceMs?: number;
    };
export type Strategy = {
  readonly type: "strategy";
  readonly id: string;
  readonly members: readonly string[];
  readonly implementations: {
    readonly surge?: GroupAlgorithm;
    readonly "sing-box"?: GroupAlgorithm;
    readonly mihomo?: GroupAlgorithm;
    readonly stash?: GroupAlgorithm;
  };
};
export type StrategySelection = {
  readonly id: string;
  readonly engine: Engine;
  readonly algorithm: GroupAlgorithm;
  readonly members: readonly string[];
};
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
export type Group = Exclude<ConcreteGroup, { readonly type: "surge-smart" }> | Strategy;
export type Engine = "surge" | "sing-box" | "mihomo" | "stash";
export type Program = {
  readonly engine: Engine;
  readonly nodes: readonly ProxyNode[];
  readonly endpoints?: readonly TailscaleEndpoint[];
  readonly groups: readonly Group[];
  readonly routing: readonly Entry[];
  readonly fallback: Action;
  readonly listener?: { readonly port: number; readonly resolver: string };
};
export type Target = {
  readonly id: string;
  readonly program: string;
  readonly engine: Engine;
  readonly platform: "macos" | "linux";
  readonly version: string;
  readonly mode?: "fragment" | "standalone";
};
export type Request = {
  readonly network: Network;
  readonly domain?: string;
  readonly ip?: string;
  readonly sourceIp?: string;
  readonly port?: number;
  readonly sourcePort?: number;
};
export type PolicyCase = {
  readonly id: string;
  readonly program: string;
  readonly request: Request;
  readonly expect: { readonly rule?: string; readonly action: Action };
};
export type Config = {
  readonly programs: Readonly<Record<string, Program>>;
  readonly targets: readonly Target[];
  readonly cases?: readonly PolicyCase[];
  readonly warningsAsErrors?: boolean;
};
export type Diagnostic = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly target?: string;
};
export type ExpandedRule = {
  readonly id: string;
  readonly when: Match;
  readonly then: Action;
  readonly origin: readonly string[];
};
export type ConditionTrace = {
  readonly type: Match["type"];
  readonly matched: boolean | null;
  readonly reason: string;
  readonly children?: readonly ConditionTrace[];
};
export type Explanation = {
  readonly mode: "static";
  readonly rule: string;
  readonly action: Action;
  readonly trace: readonly {
    readonly id: string;
    readonly origin: readonly string[];
    readonly condition: ConditionTrace;
  }[];
};
