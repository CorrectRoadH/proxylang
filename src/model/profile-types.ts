// @concord-file
// @concord-implements docs/feature/profile/library/README.md
import type { RouteCase } from "./routing-types.js";
import type {
  Match,
  ProxyNode as NativeNode,
  TailscaleEndpoint,
  DnsRule,
  GroupAlgorithm,
  Secret,
  Tun,
} from "./types.js";
import type {
  SurgeGeneral,
  SurgeHost,
  SurgeCondition,
  SurgeTunnel as NativeTunnel,
  SurgeProfileInput,
} from "./surge-schema.js";
import type { SDK } from "./identity.js";
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export type Fragments<T> = T | readonly Fragments<T>[];
export type Target =
  | { readonly engine: "surge"; readonly platform: "ios"; readonly version: "5.23.0" }
  | { readonly engine: "surge"; readonly platform: "macos"; readonly version: "6.11.0" }
  | {
      readonly engine: "sing-box";
      readonly platform: "macos" | "linux";
      readonly version: "1.14.4";
    }
  | { readonly engine: "mihomo"; readonly platform: "macos" | "linux"; readonly version: "1.19.34" }
  | { readonly engine: "stash"; readonly platform: "macos"; readonly version: "5.0.0" };
export type SecretRef = Secret & SDK<"secret">;
export type Secrets<T extends string = string> = Readonly<Record<T, SecretRef>> & SDK<"secrets">;
type PublicSecrets<T> = T extends Secret
  ? SecretRef
  : T extends readonly (infer V)[]
    ? readonly PublicSecrets<V>[]
    : T extends object
      ? { readonly [K in keyof T]: PublicSecrets<T[K]> }
      : T;
type NodeOf<N> = N extends NativeNode
  ? Omit<PublicSecrets<N>, "via" | "label"> & {
      readonly via?: ProxyNode | ProxyGroup;
      readonly name?: string;
    } & SDK<"node">
  : never;
export type ProxyNode = NodeOf<NativeNode>;
export type ProxyGroup<A extends GroupAlgorithm = GroupAlgorithm> = {
  readonly type: "proxy-group";
  readonly id: string;
  readonly name?: string;
  readonly algorithm: A;
  readonly members: readonly Exit[];
  readonly surge?: {
    readonly url: string;
    readonly intervalSeconds?: number;
    readonly timeoutSeconds?: number;
  };
} & SDK<"group">;
export type ProxyGroupDefinition = ProxyGroup;
export type SurgeTunnel = PublicSecrets<NativeTunnel> & { readonly name?: string } & SDK<"tunnel">;
export type SingBoxEndpoint = PublicSecrets<TailscaleEndpoint> & {
  readonly name?: string;
} & SDK<"endpoint">;
export type Builtin = {
  readonly builtin: "DIRECT" | "REJECT" | "REJECT-DROP" | "REJECT-NO-DROP" | "REJECT-TINYGIF";
} & SDK<"builtin">;
export type Exit = ProxyNode | ProxyGroup | SurgeTunnel | SingBoxEndpoint | Builtin;
export type ProfileDestination = Exit;
export type ProfileProxy = ProxyNode | SurgeTunnel | SingBoxEndpoint;
export type ExternalRuleSet = {
  readonly type: "ruleSetSource";
  readonly id: string;
  readonly surge?: {
    readonly url: string;
    readonly format?: "rule-set" | "domain-set";
    readonly intervalSeconds?: number;
    readonly noResolve?: boolean;
    readonly includeSniffed?: boolean;
  };
  readonly singBox?: {
    readonly url: string;
    readonly format: "source" | "binary";
    readonly intervalSeconds: number;
    readonly resolve?: boolean;
  };
  readonly mihomo?: {
    readonly url: string;
    readonly format: "yaml" | "text";
    readonly behavior: "domain" | "ipcidr" | "classical";
    readonly intervalSeconds: number;
  };
} & SDK<"ruleSet">;
export type BuiltinRuleSet = {
  readonly type: "ruleSet";
  readonly id: "surge:lan" | "surge:system";
  readonly format: "rule-set";
  readonly builtin: "LAN" | "SYSTEM";
} & SDK<"ruleSet">;
export type RuleSet = ExternalRuleSet | BuiltinRuleSet;
export type ProfileCondition =
  | Exclude<Match | SurgeCondition, { type: "all" | "any" | "not" | "nativeRuleSet" | "ruleSet" }>
  | RuleSet
  | { readonly type: "all" | "any"; readonly conditions: readonly ProfileCondition[] }
  | { readonly type: "not"; readonly condition: ProfileCondition };
export type Condition = ProfileCondition;
export type Route = {
  readonly type: "route";
  readonly when: Condition;
  readonly to: Exit;
} & SDK<"route">;
export type RouteDefinition = Route;
export type SurgeConfig = {
  readonly general?: Fragments<DeepReadonly<SurgeGeneral>>;
  readonly hosts?: Fragments<DeepReadonly<SurgeHost>>;
  readonly managed?: DeepReadonly<SurgeProfileInput["managed"]>;
};
export type SingBoxOptions = {
  readonly mode?: "standalone" | "fragment";
  readonly listener?: { readonly port: number; readonly resolver: string };
  readonly tun?: Tun;
  readonly domainMatching?: "prefer-sniffed";
  readonly serverAliases?: Readonly<Record<string, string>>;
  readonly cacheFile?: boolean;
  readonly unsupportedUdp?: "reject";
};
type Common = {
  readonly cases?: Fragments<RouteCase>;
  readonly dns?: Fragments<DnsRule>;
  readonly proxies: Fragments<ProfileProxy>;
  readonly routes: Fragments<Route>;
  readonly fallback: Exit;
};
type Portable = Exclude<GroupAlgorithm, { type: "surge-smart" }>;
export type ProfileDefinition = Common &
  (
    | {
        readonly target: Extract<Target, { engine: "surge" }>;
        readonly groups: Fragments<ProxyGroup>;
        readonly surge?: SurgeConfig;
        readonly singBox?: never;
        readonly mihomo?: never;
      }
    | {
        readonly target: Extract<Target, { engine: "sing-box" }>;
        readonly groups: Fragments<ProxyGroup<Portable>>;
        readonly singBox?: SingBoxOptions;
        readonly surge?: never;
        readonly mihomo?: never;
      }
    | {
        readonly target: Extract<Target, { engine: "mihomo" }>;
        readonly groups: Fragments<ProxyGroup<Portable>>;
        readonly mihomo?: Pick<SingBoxOptions, "mode" | "listener">;
        readonly surge?: never;
        readonly singBox?: never;
      }
    | {
        readonly target: Extract<Target, { engine: "stash" }>;
        readonly groups: Fragments<ProxyGroup<Portable>>;
        readonly surge?: never;
        readonly singBox?: never;
        readonly mihomo?: never;
      }
  );
type ResolvedSurge = {
  readonly general?: DeepReadonly<SurgeGeneral>;
  readonly hosts?: readonly DeepReadonly<SurgeHost>[];
  readonly managed?: DeepReadonly<SurgeProfileInput["managed"]>;
};
type FlattenedProfile<D extends ProfileDefinition> = D extends ProfileDefinition
  ? Omit<D, "proxies" | "groups" | "routes" | "dns" | "cases" | "surge"> & {
      readonly proxies: readonly ProfileProxy[];
      readonly groups: readonly (D extends { target: { engine: "surge" } }
        ? ProxyGroup
        : ProxyGroup<Portable>)[];
      readonly routes: readonly Route[];
      readonly dns: readonly DnsRule[];
      readonly cases: readonly RouteCase[];
      readonly surge?: D extends { target: { engine: "surge" } } ? ResolvedSurge : never;
    }
  : never;
export type Profile<D extends ProfileDefinition = ProfileDefinition> = FlattenedProfile<D> &
  SDK<"profile">;
