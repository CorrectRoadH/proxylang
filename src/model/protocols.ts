// @concord-file
// @concord-implements docs/feature/profile/library/proxies.md#目标选项与-udp
import type { ProxyNode, Engine } from "./types.js";
export function nodeIsTcpOnly(node: ProxyNode, engine: Engine): boolean {
  return (
    node.type === "http" ||
    (node.type === "anytls" && engine !== "surge" && engine !== "sing-box") ||
    node.type === "vmess" ||
    (node.type === "vless" && !(engine === "sing-box" && node.packetEncoding)) ||
    (engine === "surge" && node.type === "shadowsocks" && node.surge?.udpRelay === false)
  );
}
