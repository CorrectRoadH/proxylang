import type { Match, Network } from "./types.js";
export function truthPossibilities(condition: Match, network: Network): readonly boolean[] {
  switch (condition.type) {
    case "network":
      return [condition.value === network];
    case "not":
      return truthPossibilities(condition.condition, network).map((v) => !v);
    case "all": {
      const sets = condition.conditions.map((c) => truthPossibilities(c, network));
      return [
        ...(sets.every((s) => s.includes(true)) ? [true] : []),
        ...(sets.some((s) => s.includes(false)) ? [false] : []),
      ];
    }
    case "any": {
      const sets = condition.conditions.map((c) => truthPossibilities(c, network));
      return [
        ...(sets.some((s) => s.includes(true)) ? [true] : []),
        ...(sets.every((s) => s.includes(false)) ? [false] : []),
      ];
    }
    default:
      return [false, true];
  }
}
