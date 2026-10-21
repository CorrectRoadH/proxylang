import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  buildToDirectory,
  compile,
  explain,
  match,
  proxy,
  render,
  RenderError,
  route,
  rule,
  secret,
  singbox,
  type Config,
  type ProxyNode,
  type Program,
} from "../src/index.js";
import { fixture } from "./fixtures.js";
import { protocolConfig, testUuid } from "./proxy-fixtures.js";

const vmess = proxy.vmess({ id: "vm", server: "192.0.2.10", port: 443, uuid: secret("UUID") });
const ss = proxy.shadowsocks({
  id: "ss",
  server: "192.0.2.11",
  port: 8388,
  method: "aes-128-gcm",
  password: secret("PASSWORD"),
});
const endpoint = singbox.tailscale({
  id: "home",
  hostname: "backup",
  stateDirectory: "/var/lib/proxylang/tailnet",
  acceptRoutes: true,
  bootstrapResolver: "9.9.9.9",
});
function endpointConfig(overrides: Partial<Program> = {}): Config {
  const config = fixture([rule("lan", match.ipCidr("192.168.50.0/24"), route("home"))], {
    endpoints: [endpoint],
    listener: { port: 16901, resolver: "1.1.1.1" },
    ...overrides,
  });
  return {
    ...config,
    targets: config.targets.map((target) => ({ ...target, mode: "standalone" })),
  };
}
function hasError(config: unknown, code: string): void {
  const compiled = compile(config);
  assert.equal(compiled.ok, false);
  assert.deepEqual(compiled.plans, []);
  assert.ok(
    compiled.diagnostics.some((d) => d.code === code),
    JSON.stringify(compiled.diagnostics),
  );
}

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("协议构造器保留严格字段，现有三种节点仍能编译", () => {
  for (const node of [
    proxy.http({ id: "http", server: "192.0.2.1", port: 8080, password: secret("PASSWORD") }),
    proxy.trojan({ id: "trojan", server: "192.0.2.1", port: 443, password: secret("PASSWORD") }),
    proxy.anytls({ id: "anytls", server: "192.0.2.1", port: 443, password: secret("PASSWORD") }),
  ])
    assert.equal(compile(fixture([], { nodes: [node] })).ok, true);
  // Compile-time negative cases, never evaluated by an actual config loader.
  // @ts-expect-error UUID is mandatory; password is not a VMess field.
  proxy.vmess({ id: "bad", server: "192.0.2.1", port: 443, password: secret("PASSWORD") });
  proxy.http({
    id: "bad",
    server: "192.0.2.1",
    port: 443,
    password: secret("PASSWORD"),
    // @ts-expect-error HTTP cannot carry a concrete TLS serverName.
    serverName: "x.example",
  });
  // @ts-expect-error TLS requires an explicit certificate identity.
  proxy.vless({ id: "bad", server: "192.0.2.1", port: 443, uuid: secret("UUID"), tls: {} });
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("每个目标精确编码三种SS方法、AEAD、TLS、WS、SNI与UDP", () => {
  for (const engine of ["surge", "sing-box", "mihomo", "stash"] as const) {
    let config = protocolConfig(engine);
    if (engine === "stash")
      config = {
        ...config,
        programs: { protocols: { ...config.programs.protocols!, listener: undefined } },
        targets: config.targets.map((t) => ({ ...t, mode: "fragment" })),
      };
    const compiled = compile(config);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    const resolved: string[] = [];
    const content = render(compiled, (token) => {
      resolved.push(token.name);
      return token.name === "UUID" ? testUuid : "test-only";
    })[0]!.content;
    assert.deepEqual(resolved, ["PASSWORD", "UUID"]);
    if (engine === "surge") {
      assert.match(
        content,
        /ss-0 = ss, .*encrypt-method=aes-128-gcm, password=test-only, udp-relay=true, block-quic=off/,
      );
      assert.match(
        content,
        /vmess-3 = vmess, .*username=11111111-2222-4333-8444-555555555555, vmess-aead=true, encrypt-method=aes-128-gcm, tls=true, sni=tls.example.com, ws=true, ws-path=\/proxy, ws-headers=Host:ws.example.com/,
      );
    } else if (engine === "sing-box") {
      const outbounds = JSON.parse(content).outbounds;
      assert.equal(outbounds.find((n: any) => n.tag === "ss-2").method, "chacha20-ietf-poly1305");
      const vm = outbounds.find((n: any) => n.tag === "vmess-3");
      assert.deepEqual(vm.tls, { enabled: true, server_name: "tls.example.com" });
      assert.deepEqual(vm.transport, {
        type: "ws",
        path: "/proxy",
        headers: { Host: "ws.example.com" },
      });
      assert.equal(vm.network, "tcp");
      assert.equal(vm.security, "aes-128-gcm");
      assert.equal(vm.alter_id, 0);
      assert.equal(outbounds.find((n: any) => n.tag === "vless-0").uuid, testUuid);
    } else {
      const nodes = parse(content).proxies;
      assert.equal(nodes[2].cipher, "chacha20-ietf-poly1305");
      assert.equal(nodes[2].udp, true);
      const vm = nodes.find((n: any) => n.name === "vmess-3");
      assert.equal(vm[engine === "stash" ? "sni" : "servername"], "tls.example.com");
      assert.equal(vm.cipher, "aes-128-gcm");
      assert.equal(vm.alterId, 0);
      assert.equal(vm.udp, false);
      assert.deepEqual(vm["ws-opts"], { path: "/proxy", headers: { Host: "ws.example.com" } });
    }
  }
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("严格拒绝混合凭据、未支持协议选项与会被重解释的WS路径", () => {
  for (const node of [
    { ...vmess, password: secret("PASSWORD") },
    { ...vmess, uuid: undefined },
    { ...vmess, alterId: 0 },
    { ...vmess, flow: "xtls-rprx-vision" },
    { ...ss, method: "2022-blake3-aes-128-gcm" },
    { ...ss, tls: { serverName: "tls.example.com" } },
    { ...vmess, tls: {} },
    { ...vmess, tls: { serverName: "tls.example.com", insecure: true } },
    ...["//authority/path", "/path?ed=2048", "/%2f", "/path#x", "/white space", "/line\nnext"].map(
      (path) => ({ ...vmess, transport: { type: "ws", path } }),
    ),
    {
      ...vmess,
      tls: { serverName: "tls.example.com", alpn: ["h2"] },
      transport: { type: "ws", path: "/" },
    },
    { ...vmess, tls: { serverName: "tls.example.com", alpn: ["a".repeat(256)] } },
  ])
    hasError(fixture([], { nodes: [node as ProxyNode] }), "INVALID_SCHEMA");
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("未知版本、Surge ALPN/off、Surge与Stash VLESS都失败而非降级", () => {
  for (const engine of ["surge", "stash"] as const) {
    const config = protocolConfig(engine);
    hasError(
      {
        ...config,
        programs: {
          protocols: {
            ...config.programs.protocols!,
            nodes: [proxy.vless({ ...vmess, id: "vless" })],
            routing: [],
          },
        },
      },
      "PROTOCOL_UNSUPPORTED",
    );
  }
  for (const tls of [
    { serverName: "off" },
    { serverName: "tls.example.com", alpn: ["http/1.1"] },
  ]) {
    const config = protocolConfig("surge");
    hasError(
      {
        ...config,
        programs: {
          protocols: { ...config.programs.protocols!, nodes: [{ ...vmess, tls }], routing: [] },
        },
      },
      "PROXY_OPTION_UNSUPPORTED",
    );
  }
  hasError(protocolConfig("sing-box", "1.12.1"), "UNKNOWN_TARGET");
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("VMess/VLESS的TCP限制贯穿规则、组、via与fallback，SS允许UDP", () => {
  for (const node of [vmess, proxy.vless({ ...vmess })]) {
    const nodes = [node, { ...ss, via: node.id }];
    const groups = [{ id: "choice", type: "select" as const, members: [ss.id] }];
    assert.equal(
      compile(fixture([rule("tcp", match.network("tcp"), route("choice"))], { nodes, groups })).ok,
      true,
    );
    hasError(
      fixture([rule("udp", match.network("udp"), route("choice"))], { nodes, groups }),
      "NETWORK_UNSUPPORTED",
    );
    hasError(fixture([], { nodes, groups, fallback: route("choice") }), "NETWORK_UNSUPPORTED");
  }
  assert.equal(
    compile(fixture([rule("udp", match.network("udp"), route(ss.id))], { nodes: [ss] })).ok,
    true,
  );
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("UUID按每个用途验证，共享token仍只解析一次且错误不泄漏", () => {
  const config = fixture([], { nodes: [ss, { ...vmess, uuid: secret("PASSWORD") }] });
  const compiled = compile({
    ...config,
    targets: [...config.targets, { ...config.targets[0]!, id: "older", version: "1.11.0" }],
  });
  assert.equal(compiled.ok, true);
  let count = 0;
  assert.throws(
    () =>
      render(compiled, () => {
        count++;
        return "invalid-private-uuid";
      }),
    (error: unknown) =>
      error instanceof RenderError &&
      error.code === "INVALID_UUID_SECRET" &&
      !error.message.includes("private"),
  );
  assert.equal(count, 1);
  count = 0;
  render(compiled, () => {
    count++;
    return testUuid;
  });
  assert.equal(count, 1);
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("Tailscale独立端点保留路由语义，并将控制面DNS与普通DNS隔离", () => {
  const compiled = compile(
    endpointConfig({
      endpoints: [
        {
          ...endpoint,
          authKey: secret("AUTH"),
          exitNode: "100.64.0.1",
          exitNodeAllowLanAccess: false,
        },
      ],
    }),
  );
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const explained = explain(compiled, "box", { network: "udp", ip: "192.168.50.10" });
  assert.deepEqual(explained.action, route("home"));
  const result = JSON.parse(
    render(compiled, (token) => (token.name === "AUTH" ? "test: 'key'\nline" : "password"))[0]!
      .content,
  );
  assert.deepEqual(result.endpoints, [
    {
      type: "tailscale",
      tag: "home",
      hostname: "backup",
      state_directory: endpoint.stateDirectory,
      accept_routes: true,
      domain_resolver: { server: "pl-ts-dns-home" },
      auth_key: "test: 'key'\nline",
      exit_node: "100.64.0.1",
      exit_node_allow_lan_access: false,
    },
  ]);
  assert.equal(result.dns.final, "pl-dns");
  assert.equal(result.dns.servers.find((s: any) => s.tag === "pl-dns").server, "1.1.1.1");
  assert.deepEqual(
    result.dns.servers.find((s: any) => s.tag === "pl-ts-dns-home"),
    { type: "udp", tag: "pl-ts-dns-home", server: "9.9.9.9", server_port: 53, detour: "pl-direct" },
  );
  assert.equal(
    result.outbounds.some((n: any) => n.tag === "home"),
    false,
  );
  assert.ok(compiled.plans[0]!.preconditions.some((p) => p.includes("with_tailscale")));
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("端点严格检查状态路径、唯一引用空间、版本、模式、组与via", () => {
  for (const stateDirectory of [
    "relative",
    "/",
    "/a/../b",
    "/a/",
    "/a//b",
    "/a/$HOME",
    "/a\\b",
    "/a\nb",
  ])
    hasError(endpointConfig({ endpoints: [{ ...endpoint, stateDirectory }] }), "INVALID_SCHEMA");
  hasError(
    endpointConfig({ endpoints: [{ ...endpoint, exitNodeAllowLanAccess: false }] }),
    "INVALID_SCHEMA",
  );
  hasError(endpointConfig({ endpoints: [{ ...endpoint, id: "edge" }] }), "DUPLICATE_RESOURCE");
  for (const stateDirectory of [
    endpoint.stateDirectory,
    `${endpoint.stateDirectory}/child`,
    "/var/lib/proxylang",
  ])
    hasError(
      endpointConfig({ endpoints: [endpoint, { ...endpoint, id: "second", stateDirectory }] }),
      "ENDPOINT_STATE_OVERLAP",
    );
  hasError(
    endpointConfig({ groups: [{ id: "choice", type: "select", members: ["home"] }] }),
    "ENDPOINT_REFERENCE_UNSUPPORTED",
  );
  hasError(endpointConfig({ nodes: [{ ...ss, via: "home" }] }), "ENDPOINT_REFERENCE_UNSUPPORTED");
  const config = endpointConfig();
  for (const engine of ["surge", "mihomo", "stash"] as const) {
    const target = protocolConfig(engine).targets[0]!;
    hasError(
      {
        ...config,
        programs: { home: { ...config.programs.home!, engine } },
        targets: [{ ...target, program: "home" }],
      },
      "ENDPOINT_UNSUPPORTED",
    );
  }
  hasError(
    { ...config, targets: config.targets.map((t) => ({ ...t, version: "1.11.0" })) },
    "ENDPOINT_UNSUPPORTED",
  );
  hasError(
    {
      ...config,
      programs: { home: { ...config.programs.home!, listener: undefined } },
      targets: config.targets.map((t) => ({ ...t, mode: "fragment" })),
    },
    "ENDPOINT_MODE_UNSUPPORTED",
  );
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("真实构建拒绝状态/产物重叠，失败UUID保留active，身份目录始终不创建", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-protocols-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "out");
  const stateDirectory = join(root, "identity");
  const compiled = compile(endpointConfig({ endpoints: [{ ...endpoint, stateDirectory }] }));
  const built = await buildToDirectory(compiled, output, () => "test-password");
  assert.equal(built.published, true);
  await assert.rejects(access(stateDirectory));
  const before = await readFile(join(output, "active.json"), "utf8");
  for (const overlap of [output, join(output, "state"), root]) {
    let readSecrets = false;
    const failed = await buildToDirectory(
      compile(endpointConfig({ endpoints: [{ ...endpoint, stateDirectory: overlap }] })),
      output,
      () => {
        readSecrets = true;
        return "secret";
      },
    );
    assert.equal(failed.code, "ENDPOINT_STATE_OVERLAP");
    assert.equal(readSecrets, false);
    assert.equal(await readFile(join(output, "active.json"), "utf8"), before);
  }
  const invalid = await buildToDirectory(
    compile(fixture([], { nodes: [vmess] })),
    output,
    () => "not-a-uuid",
  );
  assert.equal(invalid.code, "INVALID_UUID_SECRET");
  assert.equal(await readFile(join(output, "active.json"), "utf8"), before);
  await assert.rejects(access(stateDirectory));
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("ALPN显式保留，WS只接受HTTP/1.1，多个端点各用自己的引导解析器", () => {
  const node = { ...vmess, tls: { serverName: "tls.example.com", alpn: ["h2", "http/1.1"] } };
  for (const engine of ["sing-box", "mihomo", "stash"] as const) {
    const config = fixture([], { engine, nodes: [node] });
    const target = protocolConfig(engine).targets[0]!;
    const compiled = compile({
      ...config,
      targets: [{ ...target, program: "home", mode: "fragment" }],
    });
    assert.equal(compiled.ok, true);
    const content = render(compiled, () => testUuid)[0]!.content;
    assert.deepEqual(
      engine === "sing-box"
        ? JSON.parse(content).outbounds[1].tls.alpn
        : parse(content).proxies[0].alpn,
      ["h2", "http/1.1"],
    );
  }
  const ws = {
    ...node,
    tls: { ...node.tls, alpn: ["http/1.1"] },
    transport: { type: "ws" as const, path: "/" },
  };
  assert.equal(compile(fixture([], { nodes: [ws] })).ok, true);
  for (const alpn of [[], ["h2", "h2"], ["é".repeat(128)], ["line\nnext"]])
    hasError(fixture([], { nodes: [{ ...node, tls: { ...node.tls, alpn } }] }), "INVALID_SCHEMA");
  const compiled = compile(
    endpointConfig({
      endpoints: [
        endpoint,
        {
          ...endpoint,
          id: "work",
          stateDirectory: "/var/lib/proxylang/work",
          bootstrapResolver: "8.8.8.8",
        },
      ],
    }),
  );
  assert.equal(compiled.ok, true);
  const output = JSON.parse(render(compiled, () => "password")[0]!.content);
  assert.equal(output.dns.final, "pl-dns");
  assert.equal(output.dns.servers.length, 3);
  assert.equal(output.endpoints[1].domain_resolver.server, "pl-ts-dns-work");
  assert.equal(
    output.dns.servers.find((server: any) => server.tag === "pl-ts-dns-work").server,
    "8.8.8.8",
  );
});
