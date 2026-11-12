// @concord-file
// @concord-implements docs/feature/target-compilation/match-options.md
import type { Match, Program, Request } from "./types.js";

export const builtinMember = (id: string): boolean => id === "DIRECT" || id === "REJECT";
export const singboxMemberTag = (id: string): string =>
  id === "DIRECT" ? "pl-direct" : id === "REJECT" ? "pl-reject" : id;

/** Only top-level atoms (or transparent named wrappers) can request ordered DNS. */
export function needsResolve(condition: Match): boolean {
  if (condition.type === "ruleSet") return needsResolve(condition.when);
  return (
    (condition.type === "ipCidr" && condition.noResolve !== true) ||
    (condition.type === "nativeRuleSet" &&
      condition.engine === "sing-box" &&
      condition.resolve === true)
  );
}

export class StaticMetadataUnknownError extends Error {
  constructor() {
    super("STATIC_METADATA_UNKNOWN");
    this.name = "StaticMetadataUnknownError";
  }
}

export function requestForProgram(
  program: Pick<Program, "domainMatching">,
  request: Request,
): Request {
  if (program.domainMatching !== "prefer-sniffed") return request;
  if (request.tlsSni && request.httpHost && request.tlsSni !== request.httpHost) {
    throw new StaticMetadataUnknownError();
  }
  return {
    ...request,
    domain: request.tlsSni || request.httpHost || request.domain,
    tlsSni: undefined,
    httpHost: undefined,
  };
}
