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
