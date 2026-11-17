import {
  exactDefinition,
  inspectDefinition,
  ProfileDefinitionError,
} from "../model/definitions.js";
import type { SurgeCondition } from "../model/surge-schema.js";
type Options = { readonly noResolve?: boolean; readonly includeSniffed?: never };
type DomainOptions = { readonly noResolve?: boolean; readonly includeSniffed?: boolean };
function condition<T extends SurgeCondition>(value: T): T {
  inspectDefinition(value);
  const fields =
    value.type === "ruleSet"
      ? ["format", "url", "builtin", "intervalSeconds"]
      : value.type === "all" || value.type === "any"
        ? ["conditions"]
        : value.type === "not"
          ? ["condition"]
          : value.type === "port" || value.type === "sourcePort"
            ? ["from", "to"]
            : ["value"];
  exactDefinition(value, [
    "type",
    "noResolve",
    ...fields,
    ...(["domain", "domainSuffix", "ruleSet"].includes(value.type) ? ["includeSniffed"] : []),
  ]);
  if (value.includeSniffed !== undefined && typeof value.includeSniffed !== "boolean")
    throw new ProfileDefinitionError("INVALID_MATCH_OPTIONS");
  return value;
}
function atom<
  K extends
    | "domain"
    | "domainSuffix"
    | "ipCidr"
    | "ipCidr6"
    | "sourceIp"
    | "processName"
    | "macAddress",
>(type: K) {
  return (
    value: string,
    options?: K extends "domain" | "domainSuffix" ? DomainOptions : Options,
  ): SurgeCondition => {
    inspectDefinition(options ?? {});
    exactDefinition(options ?? {}, [
      "noResolve",
      ...(["domain", "domainSuffix"].includes(type) ? ["includeSniffed"] : []),
    ]);
    return condition({ ...options, type, value } as SurgeCondition);
  };
}
export const surgeMatch = {
  ruleSet: (
    options: Omit<Extract<SurgeCondition, { type: "ruleSet" }>, "type">,
  ): SurgeCondition => {
    inspectDefinition(options);
    return condition({ ...options, type: "ruleSet" });
  },
  ipAsn: (value: number, options: Options = {}) => condition({ type: "ipAsn", value, ...options }),
  ipCidr6: (value: string, options: Options = {}) => atom("ipCidr6")(value, options),
  macAddress: (value: string) => atom("macAddress")(value),
};
