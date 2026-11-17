import type { ProxyNode, Secret } from "../../model/types.js";
import { RenderError } from "../../model/errors.js";
import { uuid } from "../../model/proxy-values.js";
type Secrets = (s: Secret) => string;
export function surgeProxy(
  node: ProxyNode,
  secret: Secrets,
  name: (id: string) => string = (id) => id,
): string {
  const atom = (value: string): string => {
    if (!/^[A-Za-z0-9_./:@+%-]+$/.test(value)) throw new RenderError("SURGE_VALUE_UNREPRESENTABLE");
    return value;
  };
  const params = [
    `${name(node.id)} = ${node.type === "shadowsocks" ? "ss" : node.type}`,
    node.server,
    String(node.port),
  ];
  switch (node.type) {
    case "http":
      if (node.username) params.push(`username=${atom(secret(node.username))}`);
      params.push(`password=${atom(secret(node.password))}`);
      break;
    case "hysteria2":
      params.push(`password=${atom(secret(node.password))}`);
      if (node.serverName) params.push(`sni=${node.serverName}`);
      if (node.skipCertVerify !== undefined) params.push(`skip-cert-verify=${node.skipCertVerify}`);
      if (node.portHopping) params.push(`port-hopping=${node.portHopping}`);
      if (node.portHoppingInterval !== undefined)
        params.push(`port-hopping-interval=${node.portHoppingInterval}`);
      break;
    case "trojan":
    case "anytls":
      params.push(`password=${atom(secret(node.password))}`);
      if (node.serverName) params.push(`sni=${node.serverName}`);
      if (node.skipCertVerify !== undefined) params.push(`skip-cert-verify=${node.skipCertVerify}`);
      break;
    case "shadowsocks":
      params.push(`encrypt-method=${node.method}`, `password=${atom(secret(node.password))}`);
      break;
    case "vmess":
      params.push(
        `username=${uuid(node.uuid, secret)}`,
        "vmess-aead=true",
        "encrypt-method=aes-128-gcm",
        `tls=${!!node.tls}`,
      );
      if (node.tls) params.push(`sni=${node.tls.serverName}`);
      if (node.tls?.skipCertVerify !== undefined)
        params.push(`skip-cert-verify=${node.tls.skipCertVerify}`);
      if (node.transport) {
        params.push("ws=true", `ws-path=${node.transport.path}`);
        if (node.transport.host) params.push(`ws-headers=Host:${node.transport.host}`);
      }
      break;
    case "vless":
      throw new RenderError("PROTOCOL_UNSUPPORTED");
  }
  if (node.tcpFastOpen !== undefined) params.push(`tfo=${node.tcpFastOpen}`);
  if (node.type === "trojan" || (node.type === "anytls" && node.surge?.udpRelay))
    params.push("udp-relay=true");
  if (node.type === "shadowsocks")
    params.push(
      `udp-relay=${node.surge?.udpRelay ?? true}`,
      `block-quic=${node.surge?.blockQuic ?? "off"}`,
    );
  if (node.type !== "shadowsocks" && "surge" in node && node.surge?.blockQuic !== undefined)
    params.push(`block-quic=${node.surge.blockQuic}`);
  if (node.via) params.push(`underlying-proxy=${name(node.via)}`);
  return params.join(", ");
}
