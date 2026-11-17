// @concord-file
// @concord-implements docs/feature/profile/library/README.md#引用规则
import {
  exactDefinition,
  inspectDefinition,
  ProfileDefinitionError,
} from "../model/definitions.js";
import { groupTestSchema } from "../model/surge-schema.js";
import { idSchema } from "../model/schema.js";
import type { GroupAlgorithm } from "../model/types.js";
import type { ProxyGroup, Condition, Exit, Route, Fragments } from "../model/profile-types.js";
import { created, flatten, parsed, requireKind } from "./data.js";
const builtin = <const B extends string>(builtin: B) => created({ builtin }, "builtin");
export const outbound = {
  direct: builtin("DIRECT"),
  reject: builtin("REJECT"),
  rejectDrop: builtin("REJECT-DROP"),
  rejectNoDrop: builtin("REJECT-NO-DROP"),
  rejectTinyGif: builtin("REJECT-TINYGIF"),
};
// @concord-code
// @concord-implements docs/feature/profile/library/README.md#分组算法
// @concord-implements docs/feature/profile/library/surge.md#分组测试参数
export function defineProxyGroup<const A extends GroupAlgorithm>(input: {
  readonly id: string;
  readonly name?: string;
  readonly algorithm: A;
  readonly members: Fragments<Exit>;
  readonly surge?: ProxyGroup<A>["surge"];
}): ProxyGroup<A> {
  inspectDefinition(input);
  exactDefinition(input, ["id", "name", "algorithm", "members", "surge"]);
  parsed(idSchema, input.id);
  if (input.surge !== undefined) parsed(groupTestSchema, input.surge);
  if (input.name !== undefined && typeof input.name !== "string")
    throw new ProfileDefinitionError("INVALID_FIELD", ["name"]);
  requireKind(input.algorithm, ["algorithm"]);
  const members = flatten(input.members);
  if (!members.length) throw new ProfileDefinitionError("EMPTY_FRAGMENT", ["members"]);
  for (const member of members)
    requireKind(member, ["node", "group", "tunnel", "endpoint", "builtin"]);
  return created({ ...input, type: "proxy-group" as const, members }, "group");
}
export function defineRoutes(input: {
  readonly when: Fragments<Condition>;
  readonly to: Exit;
}): Route[] {
  inspectDefinition(input);
  exactDefinition(input, ["when", "to"]);
  requireKind(input.to, ["node", "group", "tunnel", "endpoint", "builtin"]);
  return flatten(input.when).map((when) => {
    requireKind(when, ["condition", "ruleSet"]);
    return created({ type: "route" as const, when, to: input.to }, "route");
  });
}
