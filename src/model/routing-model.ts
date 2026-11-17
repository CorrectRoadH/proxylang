// @concord-file
// @concord-implements docs/feature/routing-cases/README.md#求值规则
import type { Profile, Condition, RuleSet, Exit } from "./profile-types.js";
import type { InspectedProfile } from "./inspect-profile.js";
import { originOf, type Origin } from "./identity.js";
import { deepFreeze } from "./schema.js";
type Atom = Exclude<Condition, { type: "all" | "any" | "not" | "ruleSetSource" | "ruleSet" }>;
export type RoutingCondition =
  | (Atom & { readonly resolves: boolean })
  | {
      readonly type: "ruleSet";
      readonly id: string;
      readonly canonical: string;
      readonly resource: RuleSet;
      readonly resolves: boolean;
    }
  | { readonly type: "all"; readonly conditions: readonly RoutingCondition[] }
  | { readonly type: "any"; readonly conditions: readonly RoutingCondition[] }
  | { readonly type: "not"; readonly condition: RoutingCondition };
export type RoutingModel = {
  readonly target: Profile["target"];
  readonly domainMatching?: "prefer-sniffed";
  readonly rules: readonly {
    readonly index: number;
    readonly when: RoutingCondition;
    readonly exit: string;
    readonly origin?: Origin;
  }[];
  readonly fallback: string;
  readonly ruleSets: ReadonlyMap<RuleSet, string>;
};
export const exitId = (exit: Exit): string => ("builtin" in exit ? exit.builtin : exit.id);
export function normalizeRouting(profile: Profile, inspected: InspectedProfile): RoutingModel {
  const sets = new Map<RuleSet, string>();
  const modern = profile.target.engine === "sing-box" && profile.target.version === "1.14.4";
  const lower = (condition: Condition): RoutingCondition => {
    if (condition.type === "all" || condition.type === "any")
      return { type: condition.type, conditions: condition.conditions.map(lower) };
    if (condition.type === "not") return { type: "not", condition: lower(condition.condition) };
    if (condition.type === "ruleSetSource" || condition.type === "ruleSet") {
      const native =
        condition.type === "ruleSetSource" ? inspected.mapped.get(condition) : undefined;
      const canonical = native?.id ?? condition.id;
      sets.set(condition, canonical);
      return {
        type: "ruleSet",
        id: condition.id,
        canonical,
        resource: condition,
        resolves: !!(modern && native?.engine === "sing-box" && native.resolve),
      };
    }
    const ip = ["ipCidr", "ipCidr6", "ipAsn"].includes(condition.type);
    const noResolve = "noResolve" in condition ? condition.noResolve : undefined;
    const resolves =
      ip &&
      (profile.target.engine === "surge" || modern
        ? noResolve !== true
        : profile.target.engine === "mihomo" || profile.target.engine === "stash"
          ? noResolve === false
          : false);
    return { ...(condition as Atom), resolves };
  };
  return deepFreeze({
    target: profile.target,
    ...(profile.singBox?.domainMatching ? { domainMatching: profile.singBox.domainMatching } : {}),
    rules: profile.routes.map((r, index) => ({
      index,
      when: lower(r.when),
      exit: exitId(r.to),
      origin: originOf(r),
    })),
    fallback: exitId(profile.fallback),
    ruleSets: sets,
  });
}
