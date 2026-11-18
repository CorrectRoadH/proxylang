import type { ProxyNode, Target, Diagnostic } from "../model/types.js";
export { nodeIsTcpOnly } from "../model/protocols.js";
export function validateProxyOptions(
  node: ProxyNode,
  target: Pick<Target, "engine" | "id"> & Partial<Omit<Target, "engine" | "id">>,
  diagnostics: Diagnostic[],
): void {
  if (node.type === "hysteria2") {
    if (target.engine === "surge" && node.portHopping && node.via)
      diagnostics.push({
        severity: "error",
        code: "PROXY_OPTION_UNSUPPORTED",
        target: target.id,
        path: `proxies.${node.id}`,
        message: "Surge 端口跳跃不能与 underlying-proxy 同用",
      });
    return;
  }
  const tls = "tls" in node ? node.tls : undefined;
  const singBox = target.engine === "sing-box";
  if (
    node.type === "vless" &&
    !singBox &&
    (node.flow !== undefined ||
      node.packetEncoding !== undefined ||
      node.reality !== undefined ||
      node.utlsFingerprint !== undefined)
  )
    diagnostics.push({
      severity: "error",
      code: "PROXY_OPTION_UNSUPPORTED",
      target: target.id,
      path: `proxies.${node.id}`,
      message: "VLESS 扩展选项仅支持 sing-box",
    });
  if (target.engine !== "surge") {
    const surgeOptions = "surge" in node ? node.surge : undefined;
    const supportedUdpDeclaration =
      singBox &&
      surgeOptions !== undefined &&
      ["trojan", "anytls", "shadowsocks"].includes(node.type) &&
      Object.keys(surgeOptions).length === 1 &&
      "udpRelay" in surgeOptions &&
      surgeOptions.udpRelay === true;
    if (
      (!singBox && node.tcpFastOpen !== undefined) ||
      (singBox && node.type === "anytls" && node.tcpFastOpen === true) ||
      (!singBox && "skipCertVerify" in node && node.skipCertVerify !== undefined) ||
      (!singBox && tls?.skipCertVerify !== undefined) ||
      (surgeOptions !== undefined && !supportedUdpDeclaration)
    )
      diagnostics.push({
        severity: "error",
        code: "PROXY_OPTION_UNSUPPORTED",
        target: target.id,
        path: `proxies.${node.id}`,
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
      path: `proxies.${node.id}`,
      message: "Surge 编码不接受特殊 SNI off 或显式 ALPN；不会丢弃 TLS 选项",
    });
  }
}
