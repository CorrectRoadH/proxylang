// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/provider-nodes.md
import { assertData, deepFreeze } from "./schema.js";
import type { ProxyNode } from "./types.js";

export type ProxyBuilder<N extends ProxyNode> = {
  readonly via: (id: string) => ProxyBuilder<N>;
  readonly label: (text: string) => ProxyBuilder<N>;
  readonly tcpFastOpen: (enabled: boolean) => ProxyBuilder<N>;
  readonly build: () => N;
};

/** Fluent construction is separate from the plain-data node consumed by the compiler. */
export function proxyBuilder<N extends ProxyNode>(
  node: N,
): ProxyBuilder<Extract<ProxyNode, { type: N["type"] }>> {
  assertData(node);
  type Node = Extract<ProxyNode, { type: N["type"] }>;
  const copy = deepFreeze(structuredClone(node)) as unknown as Node;
  const fork = (patch: {
    via?: string;
    label?: string;
    tcpFastOpen?: boolean;
  }): ProxyBuilder<Node> => proxyBuilder({ ...copy, ...patch }) as ProxyBuilder<Node>;
  return Object.freeze({
    via: (id: string) => fork({ via: id }),
    label: (text: string) => fork({ label: text }),
    tcpFastOpen: (enabled: boolean) => fork({ tcpFastOpen: enabled }),
    build: () => deepFreeze(structuredClone(copy)),
  });
}
