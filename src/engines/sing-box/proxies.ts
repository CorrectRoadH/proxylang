import type { ProxyNode, Secret } from "../../model/types.js";
import type { Json } from "../../model/errors.js";
import { uuid } from "../../model/proxy-values.js";
type Secrets = (s: Secret) => string;
export function singboxProxy(node: ProxyNode, secret: Secrets): Record<string, Json> {
  const result: Record<string, Json> = {
    type: node.type,
    tag: node.id,
    server: node.server,
    server_port: node.port,
    ...(node.via ? { detour: node.via } : {}),
    ...(node.tcpFastOpen !== undefined ? { tcp_fast_open: node.tcpFastOpen } : {}),
  };
  switch (node.type) {
    case "hysteria2":
      result.password = secret(node.password);
      result.tls = {
        enabled: true,
        ...(node.serverName ? { server_name: node.serverName } : {}),
        ...(node.skipCertVerify !== undefined ? { insecure: node.skipCertVerify } : {}),
      };
      if (node.portHopping) {
        delete result.server_port;
        result.server_ports = node.portHopping
          .split(";")
          .map((part) => (part.includes("-") ? part.replace("-", ":") : `${part}:${part}`));
      }
      if (node.portHoppingInterval !== undefined)
        result.hop_interval = `${node.portHoppingInterval}s`;
      break;
    case "http":
      result.password = secret(node.password);
      if (node.username) result.username = secret(node.username);
      break;
    case "trojan":
    case "anytls":
      result.password = secret(node.password);
      result.tls = {
        enabled: true,
        ...(node.serverName ? { server_name: node.serverName } : {}),
        ...(node.skipCertVerify !== undefined ? { insecure: node.skipCertVerify } : {}),
      };
      break;
    case "shadowsocks":
      result.password = secret(node.password);
      result.method = node.method;
      break;
    case "vmess":
    case "vless":
      result.uuid = uuid(node.uuid, secret);
      result.network = "tcp";
      if (node.type === "vless") {
        if (node.flow) result.flow = node.flow;
        if (node.packetEncoding) {
          result.packet_encoding = node.packetEncoding;
          delete result.network;
        }
      }
      if (node.type === "vmess") Object.assign(result, { security: "aes-128-gcm", alter_id: 0 });
      if (node.tls)
        result.tls = {
          enabled: true,
          server_name: node.tls.serverName,
          ...(node.tls.alpn ? { alpn: [...node.tls.alpn] } : {}),
          ...(node.tls.skipCertVerify !== undefined ? { insecure: node.tls.skipCertVerify } : {}),
          ...(node.type === "vless" && node.utlsFingerprint
            ? { utls: { enabled: true, fingerprint: node.utlsFingerprint } }
            : {}),
          ...(node.type === "vless" && node.reality
            ? {
                reality: {
                  enabled: true,
                  public_key: node.reality.publicKey,
                  short_id: node.reality.shortId,
                },
              }
            : {}),
        };
      if (node.transport)
        result.transport = {
          type: "ws",
          path: node.transport.path,
          ...(node.transport.host ? { headers: { Host: node.transport.host } } : {}),
        };
      break;
  }
  return result;
}
