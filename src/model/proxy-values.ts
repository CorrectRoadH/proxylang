import type { ProxyNode, Secret } from "./types.js";
import { RenderError } from "./errors.js";
type Secrets = (s: Secret) => string;
export function uuid(token: Secret, secret: Secrets): string {
  const value = secret(token);
  // Validate at each use, even when this token was cached by another credential field.
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    throw new RenderError("INVALID_UUID_SECRET");
  return value;
}
export function aliasProxyServer(
  node: ProxyNode,
  aliases?: Readonly<Record<string, string>>,
): ProxyNode {
  const server = aliases?.[node.server];
  if (!server) return node;
  if (node.type === "trojan" || node.type === "anytls" || node.type === "hysteria2")
    return { ...node, server, serverName: node.serverName ?? node.server };
  return { ...node, server };
}
