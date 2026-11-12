import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  compile,
  compileProfile,
  defineProfile,
  defineProxyGroup,
  direct,
  explain,
  group,
  match,
  outbound,
  proxy,
  reject,
  render,
  route,
  rule,
  ruleSet,
  secret,
  singbox,
  type ProxyNode,
} from "../src/index.js";
import { fixture } from "./fixtures.js";

function nodeConfig(node: ProxyNode, version = "1.14.4") {
  const config = fixture([], { nodes: [node], fallback: route(node.id) });
  return { ...config, targets: config.targets.map((target) => ({ ...target, version })) };
}

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("1.14.4 shares Trojan/AnyTLS TLS and UDP declarations without weakening older targets", () => {
  for (const type of ["trojan", "anytls"] as const) {
    const node = proxy[type]({
      id: "edge",
      server: "192.0.2.1",
      port: 443,
      password: secret("PASS"),
      serverName: "identity.example",
      skipCertVerify: true,
      tcpFastOpen: type === "trojan",
      surge: { udpRelay: true },
    });
    const result = compile(nodeConfig(node));
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const config = JSON.parse(render(result, () => "test-password")[0]!.content);
    const native = config.outbounds.find((outbound: { tag: string }) => outbound.tag === "edge");
    assert.deepEqual(native.tls, {
      enabled: true,
      server_name: "identity.example",
      insecure: true,
    });
    assert.equal(native.tcp_fast_open, type === "trojan");
    assert.equal(native.network, undefined, "must preserve UDP capability");
    assert.equal(compile(nodeConfig(node, "1.12.0")).ok, false);
    assert.equal(compile(nodeConfig({ ...node, surge: { blockQuic: "on" } })).ok, false);
    if (type === "anytls") {
      assert.equal(compile(nodeConfig({ ...node, tcpFastOpen: true })).ok, false);
    }
  }
});

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("Profile selectors preserve builtin defaults and cache, rejecting unsupported targets", () => {
  const selection = defineProxyGroup({
    id: "distraction",
    name: "Distraction",
    algorithm: group.select(),
    members: [outbound.reject, outbound.direct],
  });
  const input = {
    target: { engine: "sing-box" as const, platform: "macos" as const, version: "1.14.4" },
    proxies: [],
    groups: [selection],
    routes: [],
    fallback: selection,
    singBox: {
      mode: "standalone" as const,
      listener: { port: 17893, resolver: "1.1.1.1" },
      cacheFile: true,
    },
  };
  const result = compileProfile(defineProfile(input));
  assert.ok(result.engine === "sing-box" && result.ok);
  const native = JSON.parse(render(result.compilation, () => undefined)[0]!.content);
  assert.deepEqual(
    native.outbounds.find((entry: { tag: string }) => entry.tag === "distraction"),
    {
      type: "selector",
      tag: "distraction",
      outbounds: ["pl-reject", "pl-direct"],
      default: "pl-reject",
      interrupt_exist_connections: false,
    },
  );
  assert.ok(native.outbounds.some((entry: { type: string }) => entry.type === "block"));
  assert.deepEqual(native.experimental, { cache_file: { enabled: true } });
  assert.equal(
    compileProfile({ ...input, target: { ...input.target, version: "1.12.0" } }).ok,
    false,
  );
  assert.equal(
    compileProfile({ ...input, singBox: { mode: "fragment", cacheFile: true } }).ok,
    false,
  );
});

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("explicit sniff adaptation chooses one source without overriding destination or changing default OR rejection", () => {
  const base = fixture(
    [
      rule("original", match.domain("original.test", { includeSniffed: true }), reject()),
      rule("sniffed", match.domain("sniffed.test"), direct()),
    ],
    { domainMatching: "prefer-sniffed" },
  );
  const input = {
    ...base,
    targets: base.targets.map((target) => ({ ...target, version: "1.14.4" })),
  };
  const result = compile(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(
    explain(result, "box", { network: "tcp", domain: "original.test", tlsSni: "sniffed.test" })
      .rule,
    "home/sniffed",
  );
  assert.throws(
    () =>
      explain(result, "box", {
        network: "tcp",
        domain: "original.test",
        tlsSni: "a.test",
        httpHost: "b.test",
      }),
    /STATIC_METADATA_UNKNOWN/,
  );
  const native = JSON.parse(render(result, () => "test-pass")[0]!.content);
  assert.deepEqual(native.route.rules[0], { action: "sniff", sniffer: ["http", "tls"] });
  assert.equal(
    compile({
      ...input,
      programs: { home: { ...input.programs.home!, domainMatching: undefined } },
    }).ok,
    false,
  );
  assert.equal(compile(base).ok, false);
});

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("ordered resolve is guarded, reflected in source maps and never hoisted across a logical guard", () => {
  const base = fixture([
    rule("early", match.domain("early.test"), direct()),
    rule("named", ruleSet({ id: "lan", when: match.ipCidr("10.0.0.0/8") }), direct()),
    rule("existing", match.ipCidr("192.168.0.0/16", { noResolve: true }), direct()),
    rule(
      "remote",
      singbox.ruleSet({
        id: "remote",
        url: "https://example.com/cidr.json",
        format: "source",
        intervalSeconds: 86400,
        resolve: true,
      }),
      direct(),
    ),
  ]);
  const input = {
    ...base,
    targets: base.targets.map((target) => ({ ...target, version: "1.14.4" })),
  };
  const result = compile(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const native = JSON.parse(render(result, () => "test-pass")[0]!.content);
  assert.deepEqual(native.route.rules[1], {
    ip_cidr: ["0.0.0.0/0", "::/0"],
    invert: true,
    action: "resolve",
  });
  assert.deepEqual(
    result.plans[0]!.sourceMap.map((entry) => entry.nativeIndex),
    [0, 2, 3, 5],
  );
  assert.equal(explain(result, "box", { network: "tcp", domain: "early.test" }).rule, "home/early");
  assert.throws(
    () => explain(result, "box", { network: "tcp", domain: "unknown.test" }),
    /STATIC_METADATA_UNKNOWN/,
  );
  for (const condition of [
    match.all(match.domain("a.test"), match.ipCidr("10.0.0.0/8")),
    match.any(match.ipCidr("10.0.0.0/8"), match.ipCidr("192.168.0.0/16", { noResolve: true })),
    match.not(match.ipCidr("10.0.0.0/8")),
  ]) {
    assert.equal(
      compile({
        ...input,
        programs: {
          home: { ...base.programs.home!, routing: [rule("guard", condition, direct())] },
        },
      }).ok,
      false,
    );
  }
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("server aliases are single-hop dial addresses and preserve explicit or implicit TLS identities", () => {
  for (const serverName of [undefined, "certificate.test"]) {
    const node = proxy.trojan({
      id: "edge",
      server: "original.test",
      port: 443,
      password: secret("PASS"),
      serverName,
    });
    const base = nodeConfig(node);
    const input = {
      ...base,
      programs: {
        home: {
          ...base.programs.home!,
          serverAliases: { "original.test": "alias.test", "alias.test": "192.0.2.5" },
        },
      },
    };
    const result = compile(input);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const native = JSON.parse(render(result, () => "test-pass")[0]!.content).outbounds.find(
      (entry: { tag: string }) => entry.tag === "edge",
    );
    assert.equal(native.server, "alias.test");
    assert.equal(native.tls.server_name, serverName ?? "original.test");
    assert.equal(native.server_port, 443);
  }
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("mixed protocol candidates require explicit runtime UDP rejection without changing capabilities", () => {
  const node = proxy.http({
    id: "http-only",
    server: "192.0.2.1",
    port: 8080,
    password: secret("PASS"),
  });
  const input = nodeConfig(node);
  assert.ok(compile(input).diagnostics.some((d) => d.code === "NETWORK_UNSUPPORTED"));
  const configured = {
    ...input,
    programs: { home: { ...input.programs.home, unsupportedUdp: "reject" as const } },
  };
  const result = compile(configured);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const native = JSON.parse(render(result, () => "test-only")[0]!.content);
  assert.equal(native.route.final, "http-only");
  assert.equal(native.outbounds.find((o: { tag: string }) => o.tag === "http-only").type, "http");
  assert.equal(
    compile({
      ...configured,
      targets: configured.targets.map((t) => ({ ...t, version: "1.12.0" })),
    }).ok,
    false,
  );
});
