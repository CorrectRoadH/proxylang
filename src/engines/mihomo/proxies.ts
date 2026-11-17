import type { ProxyNode, Secret } from "../../model/types.js";
import type { Json } from "../../model/errors.js";
import { uuid } from "../../model/proxy-values.js";
type Secrets = (s: Secret) => string;
export function clashProxy(
  node: ProxyNode,
  secret: Secrets,
  name: (id: string) => string = (id) => id,
): Record<string, Json> {
  const result: Record<string, Json> = {
    name: name(node.id),
    type: node.type === "shadowsocks" ? "ss" : node.type,
    server: node.server,
    port: node.port,
    ...(node.via ? { "dialer-proxy": name(node.via) } : {}),
  };
  switch (node.type) {
    case "hysteria2":
      result.password = secret(node.password);
      if (node.serverName) result.sni = node.serverName;
      if (node.skipCertVerify !== undefined) result["skip-cert-verify"] = node.skipCertVerify;
      if (node.portHopping) result.ports = node.portHopping.replaceAll(";", ",");
      if (node.portHoppingInterval !== undefined) result["hop-interval"] = node.portHoppingInterval;
      break;
    case "http":
      result.password = secret(node.password);
      if (node.username) result.username = secret(node.username);
      break;
    case "trojan":
    case "anytls":
      result.password = secret(node.password);
      if (node.serverName) result.sni = node.serverName;
      if (node.type === "trojan") result.udp = true;
      break;
    case "shadowsocks":
      result.password = secret(node.password);
      result.cipher = node.method;
      result.udp = true;
      break;
    case "vmess":
    case "vless":
      result.uuid = uuid(node.uuid, secret);
      result.udp = false;
      if (node.type === "vmess") Object.assign(result, { cipher: "aes-128-gcm", alterId: 0 });
      result.tls = !!node.tls;
      if (node.tls) {
        result.servername = node.tls.serverName;
        if (node.tls.alpn) result.alpn = [...node.tls.alpn];
      }
      if (node.transport) {
        result.network = "ws";
        result["ws-opts"] = {
          path: node.transport.path,
          ...(node.transport.host ? { headers: { Host: node.transport.host } } : {}),
        };
      }
      break;
  }
  return result;
}
