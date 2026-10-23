// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/surge-profile.md
import { selectNodes } from "./dsl.js";
import type { ProxyNode } from "./types.js";
import type { SurgeProfileInput, SurgePolicy } from "./surge-profile.js";

/** Bind shared names only for included resources; explicit input mappings remain compiler-checked. */
export function surgeProfile(
  input: SurgeProfileInput,
  names: Readonly<Record<string, string>> = {},
): SurgeProfileInput {
  const bindings: Record<string, string> = {};
  for (const node of input.nodes) bindings[node.id] = names[node.id] ?? node.label ?? node.id;
  for (const resource of [...(input.tunnels ?? []), ...input.groups])
    bindings[resource.id] = names[resource.id] ?? resource.id;
  return { ...input, names: { ...bindings, ...input.names } };
}

/** Stable queries produce native-profile policy references without consumer mapping code. */
export function surgeMembers(
  nodes: readonly ProxyNode[],
  query: Parameters<typeof selectNodes>[1] = {},
): SurgePolicy[] {
  return selectNodes(nodes, query).map((ref) => ({ ref }));
}
