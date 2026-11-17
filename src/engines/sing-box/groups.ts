import type { ConcreteGroup } from "../../model/types.js";
export function singboxGroup(
  group: ConcreteGroup,
  name: (id: string) => string = (id) => id,
): Record<string, string | number | boolean | string[]> {
  if (group.type !== "select" && group.type !== "urltest") throw new Error("GROUP_UNSUPPORTED");
  return group.type === "select"
    ? {
        type: "selector",
        tag: name(group.id),
        outbounds: group.members.map(name),
        default: name(group.members[0]!),
        interrupt_exist_connections: false,
      }
    : {
        type: "urltest",
        tag: name(group.id),
        outbounds: group.members.map(name),
        url: group.url,
        interval: `${group.intervalSeconds ?? 180}s`,
        tolerance: group.toleranceMs ?? 50,
        idle_timeout: "30m",
        interrupt_exist_connections: false,
      };
}
