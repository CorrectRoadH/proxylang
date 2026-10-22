// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/define-proxies.md
import type { Diagnostic, Engine, ProxyNode, Secret, Target } from "./types.js";

export class RenderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RenderError";
  }
}
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Secrets = (token: Secret) => string;

export function pathsOverlap(a: string, b: string): boolean {
  return (
    a === b ||
    a.startsWith(b.endsWith("/") ? b : `${b}/`) ||
    b.startsWith(a.endsWith("/") ? a : `${a}/`)
  );
}
export function nodeIsTcpOnly(node: ProxyNode, engine: Engine): boolean {
  return (
    node.type === "http" ||
    (node.type === "anytls" && engine !== "surge") ||
    node.type === "vmess" ||
    node.type === "vless" ||
    (engine === "surge" && node.type === "shadowsocks" && node.surge?.udpRelay === false)
  );
}
export function validateProxyOptions(
  node: ProxyNode,
  target: Target,
  diagnostics: Diagnostic[],
): void {
  const tls = "tls" in node ? node.tls : undefined;
  if (target.engine !== "surge") {
    if (
      node.tcpFastOpen !== undefined ||
      ("skipCertVerify" in node && node.skipCertVerify !== undefined) ||
      tls?.skipCertVerify !== undefined ||
      ("surge" in node && node.surge !== undefined)
    )
      diagnostics.push({
        severity: "error",
        code: "PROXY_OPTION_UNSUPPORTED",
        target: target.id,
        path: `targets.${target.id}.nodes.${node.id}`,
        message: "显式节点选项尚未实现此精确目标的编码",
      });
    return;
  }
  const name = "serverName" in node ? node.serverName : tls?.serverName;
  if (name === "off" || tls?.alpn !== undefined) {
    diagnostics.push({
      severity: "error",
      code: "PROXY_OPTION_UNSUPPORTED",
      target: target.id,
      path: `targets.${target.id}.nodes.${node.id}`,
      message: "Surge 编码不接受特殊 SNI off 或显式 ALPN；不会丢弃 TLS 选项",
    });
  }
}
function uuid(token: Secret, secret: Secrets): string {
  const value = secret(token);
  // Validate at each use, even when this token was cached by another credential field.
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    throw new RenderError("INVALID_UUID_SECRET");
  return value;
}
export function singboxProxy(node: ProxyNode, secret: Secrets): Record<string, Json> {
  const result: Record<string, Json> = {
    type: node.type,
    tag: node.id,
    server: node.server,
    server_port: node.port,
    ...(node.via ? { detour: node.via } : {}),
  };
  switch (node.type) {
    case "http":
      result.password = secret(node.password);
      if (node.username) result.username = secret(node.username);
      break;
    case "trojan":
    case "anytls":
      result.password = secret(node.password);
      result.tls = { enabled: true, ...(node.serverName ? { server_name: node.serverName } : {}) };
      break;
    case "shadowsocks":
      result.password = secret(node.password);
      result.method = node.method;
      break;
    case "vmess":
    case "vless":
      result.uuid = uuid(node.uuid, secret);
      result.network = "tcp";
      if (node.type === "vmess") Object.assign(result, { security: "aes-128-gcm", alter_id: 0 });
      if (node.tls)
        result.tls = {
          enabled: true,
          server_name: node.tls.serverName,
          ...(node.tls.alpn ? { alpn: [...node.tls.alpn] } : {}),
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
export function clashProxy(
  node: ProxyNode,
  engine: "mihomo" | "stash",
  secret: Secrets,
): Record<string, Json> {
  const result: Record<string, Json> = {
    name: node.id,
    type: node.type === "shadowsocks" ? "ss" : node.type,
    server: node.server,
    port: node.port,
    ...(node.via ? { "dialer-proxy": node.via } : {}),
    ...(engine === "stash" ? { "block-quic": "off" } : {}),
  };
  switch (node.type) {
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
        result[engine === "stash" ? "sni" : "servername"] = node.tls.serverName;
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
