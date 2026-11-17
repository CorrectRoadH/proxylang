// @concord-file
// @concord-implements docs/feature/routing-cases/library.md#check-结果中的案例
import type { Profile } from "../model/profile-types.js";
import type { CaseResult } from "../model/routing-types.js";
import type { ProfileDiagnostic } from "../model/types.js";
import { exitId } from "../model/routing-model.js";
import { originOf } from "../model/identity.js";
import { ProfileDefinitionError } from "../model/definitions.js";
import { parseRequest } from "../routing/request.js";
import { prepareAssumptions } from "../routing/assumptions.js";
import { evaluate } from "../routing/evaluate.js";
import type { PreparedProfile } from "./plans.js";
export function checkCases(
  profile: Profile,
  key: string,
  prepared: PreparedProfile,
  valid: boolean,
): { diagnostics: ProfileDiagnostic[]; cases: CaseResult[] } {
  const diagnostics: ProfileDiagnostic[] = [];
  const cases: CaseResult[] = [];
  const names = new Set<string>();
  const add = (code: string, path: string, resource: unknown) =>
    diagnostics.push({
      severity: "error",
      code,
      path,
      profile: key,
      message: code,
      origin: originOf(resource) ?? originOf(profile),
    });
  const parsed = profile.cases.map((c, index) => {
    const path = `cases[${index}]`;
    if (names.has(c.name)) add("CASE_NAME_DUPLICATE", path + ".name", c);
    names.add(c.name);
    let request;
    try {
      request = parseRequest(c.request);
    } catch (e) {
      for (const field of e instanceof ProfileDefinitionError
        ? (e.paths ?? ["request"])
        : ["request"])
        add("INVALID_REQUEST", path + ".request" + (field === "request" ? "" : "." + field), c);
    }
    const assume = prepared.ruleSets
      ? prepareAssumptions({ ruleSets: prepared.ruleSets }, c.assume)
      : undefined;
    for (const e of assume?.errors ?? []) add(e.code, path + "." + e.path, c);
    return { c, request, assume };
  });
  const runnable = valid && diagnostics.length === 0 && prepared.routing !== undefined;
  for (const { c, request, assume } of parsed) {
    const base = { name: c.name, profile: key, expected: exitId(c.expect) };
    if (!runnable || !request || !assume) {
      cases.push({ ...base, ok: false, outcome: "skipped" });
      continue;
    }
    const explanation = evaluate(prepared.routing!, request, assume.values);
    cases.push({
      ...base,
      ok: explanation.outcome !== "indeterminate" && explanation.exit === base.expected,
      outcome: explanation.outcome,
      ...(explanation.exit ? { actual: explanation.exit } : {}),
      ...(explanation.needs ? { needs: explanation.needs } : {}),
      ...(explanation.route ? { route: explanation.route } : {}),
    });
  }
  return { diagnostics, cases };
}
