import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  compile,
  compileProfile,
  defineProfile,
  defineProxyGroup,
  group,
  proxy,
  render,
  secret,
  type Config,
  type Program,
  type VLESSNode,
} from "../src/index.js";

const edge: VLESSNode = {
  type: "vless",
  id: "edge",
  server: "192.0.2.1",
  port: 443,
  uuid: secret("UUID"),
  tls: { serverName: "example.com", skipCertVerify: false },
  flow: "xtls-rprx-vision",
  packetEncoding: "xudp",
  utlsFingerprint: "chrome",
  reality: { publicKey: Buffer.alloc(32, 1).toString("base64url"), shortId: "aabb" },
};
const tun = {
  address: ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
  stack: "system",
  autoRoute: true,
  strictRoute: true,
  dnsMode: "hijack",
  routeExcludeAddress: ["100.64.0.0/10", "fd7a:115c:a1e0::/48"],
} as const;
function fixture(overrides: Partial<Program> = {}, version = "1.14.4"): Config {
  return {
    programs: {
      home: {
        engine: "sing-box",
        nodes: [edge],
        groups: [],
        routing: [],
        fallback: { type: "route", to: "edge" },
        listener: { port: 1080, resolver: "1.1.1.1" },
        tun,
        ...overrides,
      },
    },
    targets: [
      {
        id: "mac",
        program: "home",
        engine: "sing-box",
        platform: "macos",
        version,
        mode: "standalone",
      },
    ],
  };
}
const resolveSecret = () => "00000000-0000-4000-8000-000000000001";
function failure(config: unknown, code: string) {
  const result = compile(config);
  assert.equal(result.ok, false);
  assert.deepEqual(result.plans, []);
  assert.ok(
    result.diagnostics.some((entry) => entry.code === code),
    JSON.stringify(result.diagnostics),
  );
}

// @test docs/engineering/singbox-tun/README.md
test("Profile lowers dual-stack TUN and Reality/Vision with explicit UDP encoding", () => {
  const node = proxy.vless({ ...edge, server: "edge.example.com" });
  const choice = defineProxyGroup({
    id: "choice",
    name: "Choice",
    algorithm: group.select(),
    members: [node],
  });
  const result = compileProfile(
    defineProfile({
      target: { engine: "sing-box", platform: "macos", version: "1.14.4" },
      proxies: [node],
      groups: [choice],
      routes: [],
      fallback: choice,
      singBox: { mode: "standalone", listener: { port: 1080, resolver: "1.1.1.1" }, tun },
    }),
  );
  assert.equal(result.engine, "sing-box");
  if (result.engine !== "sing-box") throw new Error("wrong engine");
  assert.equal(result.ok, true, JSON.stringify(result.compilation.diagnostics));
  const output = JSON.parse(render(result.compilation, resolveSecret)[0]!.content);
  assert.deepEqual(output.inbounds[1], {
    type: "tun",
    tag: "pl-tun",
    address: [...tun.address],
    stack: "system",
    auto_route: true,
    strict_route: true,
    dns_mode: "hijack",
    route_exclude_address: [...tun.routeExcludeAddress],
  });
  assert.deepEqual(output.route.rules[0], { inbound: ["pl-tun"], port: 53, action: "hijack-dns" });
  assert.equal(output.route.auto_detect_interface, true);
  assert.equal(output.dns.servers[0].type, "udp");
  assert.equal(output.route.default_domain_resolver.server, "pl-dns");
  const outbound = output.outbounds.find((item: { tag: string }) => item.tag === "edge");
  assert.equal(outbound.server, "edge.example.com");
  assert.equal(outbound.flow, edge.flow);
  assert.equal(outbound.packet_encoding, "xudp");
  assert.equal(outbound.network, undefined);
  assert.equal(outbound.tls.insecure, false);
  assert.deepEqual(outbound.tls.utls, { enabled: true, fingerprint: "chrome" });
  assert.deepEqual(outbound.tls.reality, {
    enabled: true,
    public_key: edge.reality!.publicKey,
    short_id: "aabb",
  });
});

// @test docs/engineering/singbox-tun/README.md
test("hostname support remains gated by every consuming target", () => {
  const config = fixture({ nodes: [{ ...edge, server: "edge.example.com" }], tun: undefined });
  failure(
    {
      ...config,
      targets: [...config.targets, { ...config.targets[0]!, id: "old", version: "1.12.0" }],
    },
    "PROXY_HOSTNAME_MODE_UNSUPPORTED",
  );
});

// @test docs/engineering/singbox-tun/README.md
test("Reality and Vision reject invalid combinations before native validation", () => {
  for (const invalid of [
    { ...edge, tls: undefined },
    { ...edge, utlsFingerprint: undefined },
    { ...edge, transport: { type: "ws", path: "/" } },
    { ...edge, reality: { publicKey: "bad", shortId: "aa" } },
    { ...edge, reality: { ...edge.reality, shortId: "a" } },
    { ...edge, reality: { ...edge.reality, shortId: "aa".repeat(9) } },
    { ...edge, flow: "unknown" },
    { ...edge, packetEncoding: "unknown" },
    { ...edge, utlsFingerprint: "firefox" },
  ])
    failure(fixture({ nodes: [invalid as VLESSNode] }), "INVALID_SCHEMA");
  assert.equal(
    compile(fixture({ nodes: [{ ...edge, reality: { ...edge.reality!, shortId: "" } }] })).ok,
    true,
  );
});

// @test docs/engineering/singbox-tun/README.md
test("TUN rejects ambiguous address allocation and unsupported targets", () => {
  for (const address of [
    [],
    ["bad"],
    ["172.19.0.1/31"],
    ["fdfe::1/127"],
    ["172.19.0.3/30"],
    ["fdfe::3/126"],
    ["172.19.0.1/30", "172.20.0.1/30"],
  ])
    failure(fixture({ tun: { ...tun, address } }), "INVALID_SCHEMA");
  failure(fixture({ tun: { ...tun, autoRoute: false } }), "INVALID_SCHEMA");
  failure(fixture({}, "1.12.0"), "TUN_TARGET_UNSUPPORTED");
  const fragment = fixture();
  failure(
    { ...fragment, targets: [{ ...fragment.targets[0], mode: "fragment" }] },
    "TUN_TARGET_UNSUPPORTED",
  );
  for (const dnsMode of ["disabled", "native", "hijack"] as const) {
    const result = compile(
      fixture({ tun: { ...tun, dnsMode, autoRoute: false, strictRoute: false } }),
    );
    assert.equal(result.ok, true);
    const output = JSON.parse(render(result, resolveSecret)[0]!.content);
    assert.equal(output.inbounds[1].dns_mode, dnsMode);
    assert.equal(output.route.auto_detect_interface, undefined);
    assert.equal(output.route.rules[0].action, "hijack-dns");
  }
});

// @test docs/engineering/singbox-tun/README.md
test("TUN rejects self-referential bootstrap and DNS upstream addresses", () => {
  for (const resolver of [
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "::",
    "172.19.0.2",
    "fdfe:dcba:9876::2",
    "::ffff:127.0.0.1",
  ])
    failure(fixture({ listener: { port: 1080, resolver } }), "TUN_DNS_LOOP");
  for (const server of ["127.0.0.1", "https://[::1]/dns-query", "https://172.19.0.2/dns-query"])
    failure(fixture({ dns: [{ pattern: "example.com", server }] }), "TUN_DNS_LOOP");
  assert.equal(
    compile(
      fixture({ dns: [{ pattern: "example.com", server: "https://dns.example.com/dns-query" }] }),
    ).ok,
    true,
  );
});

// @test docs/engineering/singbox-tun/README.md
test("explicit packet encoding enables UDP through groups while TCP dependencies remain rejected", () => {
  const groups: Program["groups"] = [
    {
      type: "strategy",
      id: "auto",
      members: ["edge"],
      algorithm: {
        type: "urltest",
        url: "https://example.com",
        intervalSeconds: 300,
        toleranceMs: 50,
      },
    },
    { type: "strategy", id: "choice", members: ["auto"], algorithm: { type: "select" } },
  ];
  for (const packetEncoding of ["xudp", "packetaddr"] as const)
    assert.equal(
      compile(
        fixture({
          nodes: [{ ...edge, packetEncoding }],
          groups,
          fallback: { type: "route", to: "choice" },
        }),
      ).ok,
      true,
    );
  const limited = fixture({
    nodes: [{ ...edge, packetEncoding: undefined }],
    groups,
    fallback: { type: "route", to: "choice" },
  });
  failure(limited, "NETWORK_UNSUPPORTED");
  failure(
    fixture({
      nodes: [
        { ...edge, via: "tcp" },
        { ...edge, id: "tcp", packetEncoding: undefined },
      ],
    }),
    "NETWORK_UNSUPPORTED",
  );
  failure(fixture({ tun: undefined }, "1.12.0"), "PROXY_OPTION_UNSUPPORTED");
});
