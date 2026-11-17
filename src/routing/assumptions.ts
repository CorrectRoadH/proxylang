// @concord-file
// @concord-implements docs/feature/routing-cases/README.md#假设
import { inspectDefinition } from "../model/definitions.js";
import { kindOf } from "../model/identity.js";
import type { Assumptions } from "../model/routing-types.js";
import type { RoutingModel } from "../model/routing-model.js";
export type AssumptionError = {
  readonly code: "INVALID_ASSUMPTIONS" | "ASSUMPTION_UNKNOWN_RULESET";
  readonly path: string;
};
export function prepareAssumptions(
  model: Pick<RoutingModel, "ruleSets">,
  input: Assumptions = {},
): { values: ReadonlyMap<string, boolean>; errors: readonly AssumptionError[] } {
  const values = new Map<string, boolean>();
  const errors: AssumptionError[] = [];
  try {
    inspectDefinition(input);
  } catch {
    return { values, errors: [{ code: "INVALID_ASSUMPTIONS", path: "assume" }] };
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !["hit", "miss"].includes(k))
  )
    return { values, errors: [{ code: "INVALID_ASSUMPTIONS", path: "assume" }] };
  for (const field of ["hit", "miss"] as const) {
    const refs = input[field];
    if (refs === undefined) continue;
    if (!Array.isArray(refs)) {
      errors.push({ code: "INVALID_ASSUMPTIONS", path: `assume.${field}` });
      continue;
    }
    refs.forEach((ref, i) => {
      const path = `assume.${field}[${i}]`;
      if (kindOf(ref) !== "ruleSet" || !model.ruleSets.has(ref)) {
        errors.push({ code: "ASSUMPTION_UNKNOWN_RULESET", path });
        return;
      }
      const canonical = model.ruleSets.get(ref)!;
      const value = field === "hit";
      if (values.has(canonical) && values.get(canonical) !== value)
        errors.push({ code: "INVALID_ASSUMPTIONS", path });
      else values.set(canonical, value);
    });
  }
  return { values, errors };
}
