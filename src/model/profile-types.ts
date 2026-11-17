import type { Match, ProxyNode, TailscaleEndpoint, DnsRule, GroupAlgorithm } from "./types.js";
import type {
  SurgeGeneral,
  SurgeHost,
  SurgeCondition,
  SurgeTunnel,
  SurgeProfileInput,
} from "./surge-schema.js";
export interface ProxyGroupDefinition {
  readonly type: "proxy-group";
  readonly id: string;
  readonly name: string;
  readonly algorithm: GroupAlgorithm;
  readonly members: readonly ProfileDestination[];
  readonly url?: string;
  readonly intervalSeconds?: number;
  readonly timeoutSeconds?: number;
}
export type RouteDefinition = {
  readonly type: "route";
  readonly when: ProfileCondition;
  readonly to: ProfileDestination;
};
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export type ProfileCondition =
  | Exclude<Match | SurgeCondition, { type: "all" | "any" | "not" }>
  | {
      readonly type: "all" | "any";
      readonly conditions: readonly ProfileCondition[];
      readonly noResolve?: boolean;
    }
  | {
      readonly type: "not";
      readonly condition: ProfileCondition;
      readonly noResolve?: boolean;
    };
export type ProfileDestination =
  | string
  | ProxyNode
  | ProxyGroupDefinition
  | SurgeTunnel
  | TailscaleEndpoint
  | { readonly builtin: "DIRECT" | "REJECT" | "REJECT-DROP" | "REJECT-NO-DROP" | "REJECT-TINYGIF" };
export type Fragments<T> = readonly (T | Fragments<T>)[];
export type ProfileProxy = ProxyNode | SurgeTunnel | TailscaleEndpoint;
export type SurgeConfig = DeepReadonly<Pick<SurgeProfileInput, "managed" | "names">> & {
  readonly general?: DeepReadonly<SurgeGeneral> | Fragments<DeepReadonly<SurgeGeneral>>;
  readonly hosts?: Fragments<DeepReadonly<SurgeHost>>;
};
export type ProfileDefinition = {
  readonly dns?: Fragments<DnsRule>;
  readonly target:
    | SurgeProfileInput["target"]
    | {
        readonly engine: "sing-box" | "mihomo" | "stash";
        readonly platform: "macos" | "linux";
        readonly version: string;
      };
  readonly proxies: Fragments<ProfileProxy>;
  readonly groups: Fragments<ProxyGroupDefinition>;
  readonly routes: Fragments<RouteDefinition>;
  readonly fallback: ProfileDestination;
  readonly surge?: SurgeConfig;
  readonly mihomo?: {
    readonly mode?: "fragment" | "standalone";
    readonly listener?: { readonly port: number; readonly resolver: string };
  };
  readonly singBox?: {
    readonly mode?: "fragment" | "standalone";
    readonly tun?: import("./types.js").Tun;
    readonly listener?: { readonly port: number; readonly resolver: string };
    readonly domainMatching?: "prefer-sniffed";
    readonly serverAliases?: Readonly<Record<string, string>>;
    readonly cacheFile?: boolean;
    readonly unsupportedUdp?: "reject";
  };
};
export type Profile = DeepReadonly<
  Omit<ProfileDefinition, "proxies" | "groups" | "routes" | "surge" | "dns"> & {
    readonly dns?: readonly DnsRule[];
    readonly proxies: readonly ProfileProxy[];
    readonly groups: readonly ProxyGroupDefinition[];
    readonly routes: readonly RouteDefinition[];
    readonly surge?: Pick<SurgeProfileInput, "managed" | "general" | "hosts" | "names">;
  }
>;
