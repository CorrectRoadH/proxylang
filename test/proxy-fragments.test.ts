import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  compile,
  compileProxyNodes,
  renderProxyNodes,
  proxy,
  secret,
  render,
  route,
  rule,
  match,
  type ProxyNodeInput,
  type ProxyNode,
  type ProxyNodeCompilation,
} from "../src/index.js";
import { fixture } from "./fixtures.js";

const target = { engine: "surge", platform: "macos", version: "6.10.0" } as const;
const trojan = proxy.trojan({
  id: "entry",
  server: "edge.example.com",
  port: 443,
  password: secret("PASS"),
  serverName: "tls.example.com",
  skipCertVerify: true,
  tcpFastOpen: true,
  surge: { udpRelay: true },
});
const input = (nodes: readonly ProxyNode[] = [trojan]): ProxyNodeInput => ({ target, nodes });
function error(value: unknown, code: string): void {
  const result = compileProxyNodes(value);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some((d) => d.code === code),
    JSON.stringify(result.diagnostics),
  );
  assert.deepEqual(result.bindings, []);
  assert.deepEqual(result.requirements, []);
  assert.throws(
    () =>
      renderProxyNodes(result, () => {
        throw Error("must not read");
      }),
    /COMPILATION_FAILED/,
  );
}

// @use-case docs/feature/target-compilation/use-case/provider-nodes.md
test("全批原生名字、参数、外部拨号与逐节点文件边界", () => {
  const http = proxy
    .builder(
      proxy.http({
        id: "exit",
        server: "proxy.example.com",
        port: 8080,
        username: secret("USER"),
        password: secret("PASS"),
      }),
    )
    .label("display only")
    .via("relay")
    .build();
  const tls = proxy.anytls({
    id: "any",
    server: "any.example.com",
    port: 443,
    password: secret("PASS"),
    serverName: "tls.example.com",
    skipCertVerify: true,
    tcpFastOpen: false,
    surge: { udpRelay: true },
  });
  const result = compileProxyNodes({
    ...input([trojan, tls, http]),
    names: { entry: "🇭🇰 示例节点", any: "备用 节点", exit: "出口" },
    externals: [{ id: "relay", nativeName: "Relay Group", kind: "group" }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.requirements, [
    { id: "relay", nativeName: "Relay Group", kind: "group", usedBy: ["exit"] },
  ]);
  assert.equal(result.diagnostics[0]?.code, "EXTERNAL_REFERENCE_UNVERIFIED");
  const calls: string[] = [];
  const artifact = renderProxyNodes(result, (token) => {
    calls.push(token.name);
    return token.name === "PASS" ? "test-pass" : "test-user";
  });
  assert.deepEqual(calls, ["PASS", "USER"]);
  assert.deepEqual(
    artifact.entries.map((e) => e.id),
    ["entry", "any", "exit"],
  );
  assert.equal(artifact.content, artifact.entries.map((e) => e.content).join(""));
  assert.equal(
    artifact.entries[0]?.content,
    "🇭🇰 示例节点 = trojan, edge.example.com, 443, password=test-pass, sni=tls.example.com, skip-cert-verify=true, tfo=true, udp-relay=true\n",
  );
  assert.equal(
    artifact.entries[1]?.content,
    "备用 节点 = anytls, any.example.com, 443, password=test-pass, sni=tls.example.com, skip-cert-verify=true, tfo=false, udp-relay=true\n",
  );
  assert.equal(
    artifact.entries[2]?.content,
    "出口 = http, proxy.example.com, 8080, username=test-user, password=test-pass, underlying-proxy=Relay Group\n",
  );
  assert.ok(!JSON.stringify(result).includes("test-pass"));
});

// @use-case docs/feature/target-compilation/use-case/provider-nodes.md
test("builder分叉独立、显式build且保持协议类型", () => {
  const base = proxy.builder(trojan);
  const first = base.via("a").label("A").tcpFastOpen(false).build();
  const second = base.via("b").build();
  assert.equal(first.via, "a");
  assert.equal(second.via, "b");
  assert.equal(base.build().via, undefined);
  assert.equal(first.tcpFastOpen, false);
  assert.equal(second.tcpFastOpen, true);
  assert.equal(first.password.name, "PASS");
  assert.ok(Object.isFrozen(first.password));
  error(input([base as unknown as ProxyNode]), "INVALID_INPUT_GRAPH");
  proxy.http({
    id: "h",
    server: "192.0.2.1",
    port: 80,
    password: secret("PASS"),
    // @ts-expect-error HTTP cannot configure TLS certificate verification.
    skipCertVerify: true,
  });
});

// @use-case docs/feature/target-compilation/use-case/provider-nodes.md
test("名称与引用严格校验，保留名及内外环边界", () => {
  for (const name of [
    "",
    " leading",
    "trailing ",
    "DIRECT",
    "reject-drop",
    "REJECT-NO-DROP",
    "REJECT-TINYGIF",
    "pl-private",
    "a,b",
    "a\nb",
  ])
    assert.equal(compileProxyNodes({ ...input(), names: { entry: name } }).ok, false);
  error({ ...input(), names: { missing: "x" } }, "UNKNOWN_NAME_MAPPING");
  error(input([trojan, trojan]), "DUPLICATE_RESOURCE");
  error(
    { ...input(), externals: [{ id: "relay", nativeName: "entry", kind: "group" }] },
    "DUPLICATE_NATIVE_NAME",
  );
  error(input([{ ...trojan, via: "missing" }]), "MISSING_REFERENCE");
  error(input([{ ...trojan, via: "entry" }]), "RESOURCE_CYCLE");
  error(
    input([
      { ...trojan, via: "b" },
      { ...trojan, id: "b", via: "entry" },
    ]),
    "RESOURCE_CYCLE",
  );
  const compiled = compileProxyNodes(input([{ ...trojan, id: "b", via: "entry" }, trojan]));
  assert.equal(compiled.ok, true);
  assert.match(
    renderProxyNodes(compiled, () => "test").entries[0]!.content,
    /underlying-proxy=entry/,
  );
});

// @use-case docs/feature/target-compilation/use-case/provider-nodes.md
test("成功计划不可变且拒绝伪造，秘密异常不反射", () => {
  const mutable = structuredClone({ ...input(), names: { entry: "原名" } });
  const compiled = compileProxyNodes(mutable);
  Object.assign(mutable.nodes[0]!, { server: "other.example.com" });
  mutable.names.entry = "新名";
  assert.ok(Object.isFrozen(compiled));
  assert.ok(Object.isFrozen(compiled.bindings[0]));
  assert.match(
    renderProxyNodes(compiled, () => "test").content,
    /^原名 = trojan, edge.example.com/,
  );
  assert.throws(() => renderProxyNodes({ ...compiled }, () => "test"), /COMPILATION_FAILED/);
  assert.throws(
    () =>
      renderProxyNodes(JSON.parse(JSON.stringify(compiled)) as ProxyNodeCompilation, () => "test"),
    /COMPILATION_FAILED/,
  );
  for (const resolve of [
    () => {
      throw Error("PRIVATE_VALUE");
    },
    () => "PRIVATE_VALUE,invalid",
    () => undefined,
  ]) {
    try {
      renderProxyNodes(compiled, resolve);
      assert.fail("expected render error");
    } catch (e) {
      assert.ok(e instanceof Error);
      assert.ok(!e.message.includes("PRIVATE_VALUE"));
    }
  }
  const invalid = compileProxyNodes({
    ...input(),
    nodes: [{ ...trojan, password: "PRIVATE_VALUE" }],
  });
  assert.ok(!JSON.stringify(invalid).includes("PRIVATE_VALUE"));
});

// @use-case docs/feature/target-compilation/use-case/provider-nodes.md
test("目标、字段及域名入口边界不静默转换", () => {
  error({ ...input(), target: { ...target, version: "6.6.0" } }, "UNKNOWN_TARGET");
  error(
    { ...input(), target: { engine: "sing-box", platform: "linux", version: "1.12.0" } },
    "UNKNOWN_TARGET",
  );
  error(
    input([{ ...trojan, surge: { udpRelay: false } } as unknown as ProxyNode]),
    "INVALID_SCHEMA",
  );
  error(input([{ ...trojan, obfs: "tls" } as unknown as ProxyNode]), "INVALID_SCHEMA");
  assert.ok(
    compile(fixture([], { nodes: [trojan] })).diagnostics.some(
      (d) => d.code === "PROXY_HOSTNAME_MODE_UNSUPPORTED",
    ),
  );
  const plain = { ...trojan, server: "192.0.2.1" };
  const config = fixture([], { nodes: [plain] });
  assert.ok(compile(config).diagnostics.some((d) => d.code === "PROXY_OPTION_UNSUPPORTED"));
  const onlySurge = {
    ...config,
    targets: [{ ...target, id: "surge", program: "surge" }],
    programs: { surge: { ...config.programs.home!, engine: "surge" as const } },
  };
  const result = compile(onlySurge);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(
    render(result, () => "test")[0]!.content.includes(
      renderProxyNodes(compileProxyNodes(input([plain])), () => "test").content,
    ),
  );
});

// @use-case docs/feature/target-compilation/use-case/provider-nodes.md
test("空批次与显式SS选项", () => {
  assert.deepEqual(
    renderProxyNodes(compileProxyNodes(input([])), () => assert.fail()),
    { artifactKind: "proxy-nodes", content: "", entries: [] },
  );
  const ss = proxy.shadowsocks({
    id: "ss",
    server: "192.0.2.1",
    port: 443,
    method: "aes-128-gcm",
    password: secret("PASS"),
    surge: { udpRelay: false, blockQuic: "auto" },
  });
  const result = renderProxyNodes(compileProxyNodes(input([ss])), () => "test");
  assert.match(result.content, /udp-relay=false, block-quic=auto/);
  const config = fixture([], { nodes: [ss], fallback: route("ss") });
  const surge = {
    ...config,
    targets: [{ ...target, id: "surge", program: "surge" }],
    programs: { surge: { ...config.programs.home!, engine: "surge" as const } },
  };
  assert.ok(compile(surge).diagnostics.some((d) => d.code === "NETWORK_UNSUPPORTED"));
  const program = surge.programs.surge;
  assert.equal(
    compile({
      ...surge,
      programs: {
        surge: {
          ...program,
          fallback: { type: "direct" },
          routing: [rule("tcp", match.network("tcp"), route("ss"))],
        },
      },
    }).ok,
    true,
  );
});

// @use-case docs/feature/target-compilation/use-case/provider-nodes.md
test("目标UDP能力经组和via传播，AnyTLS只放行Surge", () => {
  const any = proxy.anytls({ id: "any", server: "192.0.2.2", port: 443, password: secret("PASS") });
  const box = fixture([], { nodes: [any], fallback: route("any") });
  assert.ok(compile(box).diagnostics.some((d) => d.code === "NETWORK_UNSUPPORTED"));
  const surge = {
    targets: [{ ...target, id: "surge", program: "surge" }],
    programs: { surge: { ...box.programs.home!, engine: "surge" as const } },
  };
  assert.equal(compile(surge).ok, true);
  const ss = proxy.shadowsocks({
    id: "ss",
    server: "192.0.2.3",
    port: 443,
    method: "aes-128-gcm",
    password: secret("PASS"),
    surge: { udpRelay: false },
  });
  for (const program of [
    {
      ...surge.programs.surge,
      nodes: [ss],
      groups: [{ id: "group", type: "select" as const, members: ["ss"] }],
      fallback: route("group"),
    },
    { ...surge.programs.surge, nodes: [{ ...any, via: "ss" }, ss] },
  ])
    assert.ok(
      compile({ ...surge, programs: { surge: program } }).diagnostics.some(
        (d) => d.code === "NETWORK_UNSUPPORTED",
      ),
    );
});

// @use-case docs/feature/target-compilation/use-case/provider-nodes.md
test("外部元数据冻结且不会替代输入依赖或接受未知schema", () => {
  const source = {
    ...input([{ ...trojan, via: "external" }]),
    externals: [{ id: "external", nativeName: "Original", kind: "proxy" as const }],
  };
  const compiled = compileProxyNodes(source);
  source.externals[0]!.nativeName = "Changed";
  assert.ok(Object.isFrozen(compiled.requirements[0]?.usedBy));
  assert.match(renderProxyNodes(compiled, () => "test").content, /underlying-proxy=Original/);
  error(
    { ...input(), externals: [{ id: "entry", nativeName: "Different", kind: "proxy" }] },
    "DUPLICATE_RESOURCE",
  );
  error(
    { ...input(), externals: [{ id: "external", nativeName: "x", kind: "unknown" }] },
    "INVALID_SCHEMA",
  );
  error(
    input([
      proxy.shadowsocks({
        id: "ss",
        server: "192.0.2.3",
        port: 443,
        method: "unknown" as never,
        password: secret("PASS"),
      }),
    ]),
    "INVALID_SCHEMA",
  );
  error({ ...input(), extra: "PRIVATE_VALUE" }, "INVALID_SCHEMA");
  const poisoned = {
    ...input(),
    get nodes() {
      return assert.fail("accessor must not execute");
    },
  };
  error(poisoned, "INVALID_INPUT_GRAPH");
  const huge = Array.from({ length: 1000 }, (_, i) => ({ ...trojan, id: `n-${i}` }));
  error(
    { ...input(huge), externals: [{ id: "extra", nativeName: "x", kind: "proxy" }] },
    "RESOURCE_LIMIT",
  );
});
