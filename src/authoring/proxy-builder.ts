// @concord-file
// @concord-implements docs/feature/profile/library/proxies.md#builder
import type { ProxyNode, ProxyGroup } from "../model/profile-types.js";
import { created, requireKind } from "./data.js";
import { ProfileDefinitionError } from "../model/definitions.js";
export type ProxyBuilder<N extends ProxyNode> = {
  readonly via: (exit: ProxyNode | ProxyGroup) => ProxyBuilder<N>;
  readonly name: (text: string) => ProxyBuilder<N>;
  readonly tcpFastOpen: (enabled: boolean) => ProxyBuilder<N>;
  readonly build: () => N;
};
export function proxyBuilder<N extends ProxyNode>(node: N): ProxyBuilder<N> {
  requireKind(node, ["node"]);
  const fork = (patch: object) => proxyBuilder(created({ ...node, ...patch }, "node") as N);
  return Object.freeze({
    via: (value: ProxyNode | ProxyGroup) => {
      requireKind(value, ["node", "group"]);
      return fork({ via: value });
    },
    name: (text: string) => {
      if (typeof text !== "string") throw new ProfileDefinitionError("INVALID_FIELD");
      return fork({ name: text });
    },
    tcpFastOpen: (enabled: boolean) => {
      if (typeof enabled !== "boolean") throw new ProfileDefinitionError("INVALID_FIELD");
      if (node.type === "hysteria2") throw new ProfileDefinitionError("INVALID_FIELD");
      return fork({ tcpFastOpen: enabled });
    },
    build: () => created({ ...node }, "node") as N,
  });
}
