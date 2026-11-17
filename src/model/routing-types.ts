// @concord-file
// @concord-implements docs/feature/routing-cases/library.md
import type { Exit, RuleSet } from "./profile-types.js";
export type RouteRequest = {
  readonly network?: "tcp" | "udp";
  readonly domain?: string;
  readonly sniffedDomain?: string;
  readonly ip?: string;
  readonly resolvedIp?: string;
  readonly asn?: number;
  readonly port?: number;
  readonly sourceIp?: string;
  readonly sourcePort?: number;
  readonly processName?: string;
  readonly macAddress?: string;
};
export type Assumptions = {
  readonly hit?: readonly RuleSet[];
  readonly miss?: readonly RuleSet[];
};
export type RouteCase = {
  readonly name: string;
  readonly request: RouteRequest;
  readonly assume?: Assumptions;
  readonly expect: Exit;
};

export type Need =
  | { readonly kind: "ruleSet"; readonly id: string }
  | { readonly kind: "dns" }
  | { readonly kind: "asn" };
export type Explanation = {
  readonly outcome: "matched" | "fallback" | "indeterminate";
  readonly exit?: string;
  readonly route?: { readonly index: number; readonly origin?: import("./identity.js").Origin };
  readonly needs?: Need;
  readonly trace: readonly {
    readonly index: number;
    readonly matched: boolean | null;
    readonly origin?: import("./identity.js").Origin;
  }[];
};
export type ExplainResult =
  | { readonly ok: true; readonly explanation: Explanation }
  | { readonly ok: false; readonly diagnostics: readonly import("./types.js").ProfileDiagnostic[] };
export type CaseResult = {
  readonly name: string;
  readonly profile: string;
  readonly ok: boolean;
  readonly outcome: Explanation["outcome"] | "skipped";
  readonly expected: string;
  readonly actual?: string;
  readonly needs?: Need;
  readonly route?: Explanation["route"];
};
