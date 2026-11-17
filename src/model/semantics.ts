// @concord-file
// @concord-implements docs/feature/profile/library/conditions.md
import type { Match } from "./types.js";

export const builtinMember = (id: string): boolean => id === "DIRECT" || id === "REJECT";
export const singboxMemberTag = (id: string): string =>
  id === "DIRECT" ? "pl-direct" : id === "REJECT" ? "pl-reject" : id;

/** Only top-level atoms (or transparent named wrappers) can request ordered DNS. */
export function needsResolve(condition: Match): boolean {
  return (
    (condition.type === "ipCidr" && condition.noResolve !== true) ||
    (condition.type === "nativeRuleSet" &&
      condition.engine === "sing-box" &&
      condition.resolve === true)
  );
}
