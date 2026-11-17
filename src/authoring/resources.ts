import {
  exactDefinition,
  inspectDefinition,
  ProfileDefinitionError,
} from "../model/definitions.js";
import type {
  ProxyGroupDefinition,
  RouteDefinition,
  ProfileCondition,
  ProfileDestination,
} from "../model/profile-types.js";
const fail = (code: string): never => {
  throw new ProfileDefinitionError(code);
};
export const outbound = {
  direct: Object.freeze({ builtin: "DIRECT" } as const),
  reject: Object.freeze({ builtin: "REJECT" } as const),
  rejectDrop: Object.freeze({ builtin: "REJECT-DROP" } as const),
  rejectNoDrop: Object.freeze({ builtin: "REJECT-NO-DROP" } as const),
  rejectTinyGif: Object.freeze({ builtin: "REJECT-TINYGIF" } as const),
};
export function defineProxyGroup(input: Omit<ProxyGroupDefinition, "type">): ProxyGroupDefinition {
  inspectDefinition(input);
  exactDefinition(input, [
    "id",
    "name",
    "algorithm",
    "members",
    "url",
    "intervalSeconds",
    "timeoutSeconds",
  ]);
  if (
    !input.algorithm ||
    !["select", "surge-smart", "urltest", "auto"].includes(input.algorithm.type)
  )
    fail("UNSUPPORTED_GROUP_ALGORITHM");
  exactDefinition(
    input.algorithm,
    input.algorithm.type === "urltest"
      ? ["type", "url", "intervalSeconds", "toleranceMs"]
      : ["type"],
  );
  if (!Array.isArray(input.members)) fail("INVALID_GROUP_DEFINITION");
  return {
    ...input,
    type: "proxy-group",
    algorithm: { ...input.algorithm },
    members: [...input.members],
  };
}
export function defineRoutes(input: {
  readonly when: readonly ProfileCondition[];
  readonly to: ProfileDestination;
}): RouteDefinition[] {
  inspectDefinition(input);
  exactDefinition(input, ["when", "to"]);
  if (!Array.isArray(input.when)) fail("INVALID_ROUTE_DEFINITION");
  return input.when.map((when) => ({ type: "route", when, to: input.to }));
}
