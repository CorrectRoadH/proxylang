// @concord-file
// @concord-implements docs/feature/routing-cases/library.md#explainprofile
import type { Profile } from "../model/profile-types.js";
import type { RouteRequest, Assumptions, ExplainResult } from "../model/routing-types.js";
import { prepareProfile } from "./plans.js";
import { prepareAssumptions } from "../routing/assumptions.js";
import { parseRequest } from "../routing/request.js";
import { evaluate } from "../routing/evaluate.js";
import { kindOf } from "../model/identity.js";
import { originOf } from "../model/identity.js";
export function explainProfile(
  profile: Profile,
  request: RouteRequest,
  assume?: Assumptions,
): ExplainResult {
  if (kindOf(profile) !== "profile")
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "INVALID_RESOURCE",
          path: "profile",
          profile: "profile",
          message: "INVALID_RESOURCE",
        },
      ],
    };
  const prepared = prepareProfile(profile, "profile", undefined, false);
  if (!prepared.ok || !prepared.routing)
    return {
      ok: false,
      diagnostics: prepared.diagnostics.map(({ target: _target, ...d }) => ({
        ...d,
        profile: "profile",
      })),
    };
  const parsed = parseRequest(request);
  const assumptions = prepareAssumptions(prepared.routing, assume);
  if (assumptions.errors.length)
    return {
      ok: false,
      diagnostics: assumptions.errors.map((e) => ({
        severity: "error",
        code: e.code,
        path: e.path,
        message: e.code,
        profile: "profile",
        origin: originOf(profile),
      })),
    };
  return { ok: true, explanation: evaluate(prepared.routing, parsed, assumptions.values) };
}
