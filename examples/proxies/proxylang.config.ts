import {
  defineConfig,
  direct,
  group,
  match,
  policy,
  proxy,
  route,
  rule,
  secret,
  singbox,
  slot,
  strategy,
  use,
  type Engine,
  type Program,
  type Target,
} from "proxylang";

const shared = [
  proxy.shadowsocks({
    id: "ss",
    server: "192.0.2.10",
    port: 8388,
    method: "aes-128-gcm",
    password: secret("DEMO_PASSWORD"),
  }),
  proxy.vmess({
    id: "vmess",
    server: "192.0.2.20",
    port: 443,
    uuid: secret("DEMO_UUID"),
    tls: { serverName: "tls.example.com" },
    transport: { type: "ws", path: "/proxy", host: "ws.example.com" },
  }),
];
const vless = proxy.vless({
  id: "vless",
  server: "192.0.2.30",
  port: 443,
  uuid: secret("DEMO_UUID"),
  tls: { serverName: "vless.example.com", alpn: ["http/1.1"] },
});
const office = policy({
  id: "office",
  exits: ["proxy"],
  rules: [
    rule(
      "services",
      match.all(match.network("tcp"), match.domainSuffix("example.org")),
      slot("proxy"),
    ),
  ],
});
const home = policy({
  id: "home",
  exits: ["lan"],
  rules: [rule("subnet", match.ipCidr("192.168.50.0/24"), slot("lan"))],
});
const program = (engine: Engine): Program => {
  const nodes = engine === "sing-box" || engine === "mihomo" ? [...shared, vless] : shared;
  return {
    engine,
    nodes,
    groups: [
      strategy({
        id: "outbound",
        members: nodes.map((node) => node.id),
        implementations: {
          surge: group.select(),
          "sing-box": group.select(),
          mihomo: group.select(),
          stash: group.select(),
        },
      }),
    ],
    routing: [use(office, { id: "work", bindings: { proxy: route("outbound") } })],
    fallback: direct(),
  };
};
const targets: Target[] = [
  { id: "surge", program: "surge", engine: "surge", version: "6.10.0", platform: "macos" },
  { id: "box", program: "box", engine: "sing-box", version: "1.12.0", platform: "linux" },
  { id: "mihomo", program: "mihomo", engine: "mihomo", version: "1.19.32", platform: "linux" },
  { id: "stash", program: "stash", engine: "stash", version: "4.2.1", platform: "macos" },
  {
    id: "backup",
    program: "backup",
    engine: "sing-box",
    version: "1.12.0",
    platform: "linux",
    mode: "standalone",
  },
];
export default defineConfig({
  outDir: "../../out/proxies",
  programs: {
    surge: program("surge"),
    box: program("sing-box"),
    mihomo: program("mihomo"),
    stash: program("stash"),
    backup: {
      ...program("sing-box"),
      endpoints: [
        singbox.tailscale({
          id: "home-net",
          hostname: "backup-proxy",
          stateDirectory: "/var/lib/proxylang/backup-tailnet",
          acceptRoutes: true,
          bootstrapResolver: "9.9.9.9",
          // No authKey: the operator owns initial login or existing persistent identity.
        }),
      ],
      listener: { port: 17890, resolver: "1.1.1.1" },
      routing: [
        use(home, { id: "local", bindings: { lan: route("home-net") } }),
        ...program("sing-box").routing,
      ],
    },
  },
  targets,
  cases: [
    {
      id: "home-first",
      program: "backup",
      request: { network: "udp", ip: "192.168.50.10", port: 53 },
      expect: { action: route("home-net") },
    },
  ],
});
