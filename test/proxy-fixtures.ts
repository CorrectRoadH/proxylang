import {
  direct,
  match,
  proxy,
  route,
  rule,
  secret,
  type Config,
  type Engine,
  type ProxyNode,
} from "../src/index.js";

export const testUuid = "11111111-2222-4333-8444-555555555555";
export const endpointIp = "192.0.2.10";
export function protocolNodes(engine: Engine): ProxyNode[] {
  const nodes: ProxyNode[] = (
    ["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"] as const
  ).map((method, i) =>
    proxy.shadowsocks({
      id: `ss-${i}`,
      server: endpointIp,
      port: 8388,
      method,
      password: secret("PASSWORD"),
    }),
  );
  for (const type of engine === "surge" || engine === "stash"
    ? (["vmess"] as const)
    : (["vmess", "vless"] as const)) {
    for (let i = 0; i < 4; i++)
      nodes.push(
        proxy[type]({
          id: `${type}-${i}`,
          server: endpointIp,
          port: 443,
          uuid: secret("UUID"),
          ...(i % 2 ? { tls: { serverName: "tls.example.com" } } : {}),
          ...(i >= 2 ? { transport: { type: "ws", path: "/proxy", host: "ws.example.com" } } : {}),
        }),
      );
  }
  return nodes;
}
export function protocolConfig(engine: Engine = "sing-box", version?: string): Config {
  const nodes = protocolNodes(engine);
  return {
    programs: {
      protocols: {
        engine,
        nodes,
        groups: [],
        fallback: direct(),
        listener: { port: 16900, resolver: "1.1.1.1" },
        routing: nodes.map((node, i) =>
          rule(`node-${i}`, match.all(match.network("tcp"), match.port(1000 + i)), route(node.id)),
        ),
      },
    },
    targets: [
      {
        id: "protocols",
        program: "protocols",
        engine,
        version:
          version ??
          (engine === "sing-box"
            ? "1.12.0"
            : engine === "surge"
              ? "6.10.0"
              : engine === "mihomo"
                ? "1.19.32"
                : "4.2.1"),
        platform: "macos",
        mode: "standalone",
      },
    ],
  };
}
