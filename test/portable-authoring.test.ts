import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  dnsRule,
  checkBuild,
  compile,
  compileProfile,
  defineProfile,
  defineRoute,
  match,
  outbound,
  direct,
  rule,
  render,
  renderSurgeProfile,
  proxyId,
  proxy,
  secret,
  type DnsRule,
} from "../src/index.js";
import { dnsCondition } from "../src/dns.js";
const fixture = (dns: readonly DnsRule[] = []) => ({
  target: { engine: "sing-box", platform: "macos", version: "1.12.0" } as const,
  proxies: [],
  groups: [],
  routes: [],
  fallback: outbound.direct,
  dns,
  singBox: { mode: "standalone" as const, listener: { port: 16154, resolver: "1.1.1.1" } },
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("portable DNS lowers both exact versions and preserves bootstrap isolation", () => {
  for (const version of ["1.11.0", "1.12.0"]) {
    const input = fixture([
      { pattern: "*.EXAMPLE.com", server: "https://dns.example.net:8443/custom" },
      { pattern: "example.com", server: "::1" },
    ]);
    const result = compileProfile({
      ...input,
      target: { ...input.target, version },
      proxies: [
        proxy.trojan({
          id: "edge",
          server: "192.0.2.1",
          port: 443,
          password: secret("PASS"),
          serverName: "proxy.example.com",
        }),
      ],
    });
    assert.ok(result.ok && result.engine === "sing-box", JSON.stringify(result));
    const output = JSON.parse(render(result.compilation, () => "placeholder")[0]!.content);
    assert.equal(output.route.default_domain_resolver, undefined);
    assert.equal(output.dns.final, "pl-dns");
    const regex = new RegExp(output.dns.rules[0].domain_regex[0]);
    assert.ok(regex.test("a.b.example.com"));
    assert.ok(!regex.test("example.com"));
    assert.ok(!regex.test("notexample.com"));
    if (version === "1.12.0") {
      assert.deepEqual(output.outbounds[1].domain_resolver, {
        server: "pl-dns",
        strategy: "prefer_ipv4",
      });
      const doh = output.dns.servers[1];
      assert.equal(doh.server_port, 8443);
      assert.equal(doh.path, "/custom");
      assert.equal(doh.detour, undefined);
      assert.equal(doh.domain_resolver.server, "pl-dns");
    } else assert.equal(output.dns.servers[1].address_resolver, "pl-dns");
  }
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("portable DNS validates fragments and all public entries before secrets", () => {
  const row = { pattern: "*.example.com", server: "1.1.1.1" };
  const profile = defineProfile({ ...fixture(), dns: [[row]] });
  row.server = "8.8.8.8";
  assert.equal(profile.dns![0]!.server, "1.1.1.1");
  assert.ok(Object.isFrozen(profile.dns![0]));
  for (const dns of [
    [{ pattern: "a?b.com", server: "1.1.1.1" }],
    [{ pattern: "example.com", server: "https://user:pass@example.com" }],
    [{ pattern: "example.com", server: "https://example.com/?q=1" }],
    [{ pattern: "a".repeat(254), server: "1.1.1.1" }],
    [{ pattern: "example.com", server: "https://example.com/" + "a".repeat(2048) }],
    [row, { ...row, pattern: "*.EXAMPLE.COM" }],
    [row, { pattern: "a.example.com", server: "9.9.9.9" }],
    Array.from({ length: 2001 }, (_, i) => ({ pattern: `a${i}.com`, server: "1.1.1.1" })),
  ]) {
    assert.equal(compileProfile({ ...fixture(), dns }).ok, false);
    assert.equal(
      compile({
        programs: {
          home: { engine: "sing-box", nodes: [], groups: [], routing: [], fallback: direct(), dns },
        },
        targets: [
          { id: "home", program: "home", engine: "sing-box", platform: "macos", version: "1.12.0" },
        ],
      }).ok,
      false,
    );
  }
  assert.ok(compileProfile(fixture([row, { pattern: "a.example.com", server: row.server }])).ok);
  assert.equal(compileProfile({ ...fixture([row]), singBox: { mode: "fragment" } }).ok, false);
  const surge = {
    ...fixture([row]),
    target: { engine: "surge", platform: "macos", version: "6.10.0" } as const,
    singBox: undefined,
  };
  const result = compileProfile(surge);
  assert.ok(result.ok && result.engine === "surge");
  assert.match(
    renderSurgeProfile(result.compilation, () => undefined).content,
    /\*\.example.com = server:8.8.8.8/,
  );
  for (const host of [
    { pattern: "*", address: "127.0.0.1" },
    { pattern: "a?b", server: "1.1.1.1" },
  ])
    assert.equal(compileProfile({ ...surge, surge: { hosts: [host] } }).ok, true);
  const getter = Object.defineProperty({}, "pattern", {
    get() {
      throw new Error("getter invoked");
    },
  });
  assert.equal(compileProfile({ ...fixture(), dns: [getter as DnsRule] }).ok, false);
  assert.deepEqual(dnsCondition({ pattern: "EXAMPLE.COM", server: "1.1.1.1" }), {
    domain: ["example.com"],
  });
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("portable process names and bare source IP preserve exact matching", () => {
  for (const bad of ["", "/usr/bin/app", "app*", "app?", "a,b", "a\n", "a\\b", "a".repeat(256)])
    assert.throws(() => match.processName(bad));
  for (const [engine, version] of [
    ["surge", "6.10.0"],
    ["sing-box", "1.12.0"],
    ["mihomo", "1.19.32"],
    ["stash", "4.2.1"],
  ] as const) {
    const compilation = compile({
      programs: {
        home: {
          engine,
          nodes: [],
          groups: [],
          routing: [rule("process", match.processName("App"), direct())],
          fallback: { type: "reject" },
        },
      },
      targets: [{ id: "home", program: "home", engine, version, platform: "macos" }],
      cases: [
        {
          id: "yes",
          program: "home",
          request: { network: "tcp", processName: "App" },
          expect: { action: direct() },
        },
        {
          id: "no",
          program: "home",
          request: { network: "tcp", processName: "app" },
          expect: { action: { type: "reject" } },
        },
        {
          id: "missing",
          program: "home",
          request: { network: "tcp" },
          expect: { action: { type: "reject" } },
        },
      ],
    });
    assert.ok(compilation.ok, JSON.stringify(compilation.diagnostics));
    assert.match(render(compilation, () => undefined)[0]!.content, /PROCESS-NAME,App|process_name/);
  }
  const ip = compile({
    programs: {
      home: {
        engine: "sing-box",
        nodes: [],
        groups: [],
        routing: [rule("ip", match.sourceIp("::1"), direct())],
        fallback: { type: "reject" },
      },
    },
    targets: [
      { id: "home", program: "home", engine: "sing-box", version: "1.12.0", platform: "macos" },
    ],
    cases: [
      {
        id: "yes",
        program: "home",
        request: { network: "tcp", sourceIp: "0:0:0:0:0:0:0:1" },
        expect: { action: direct() },
      },
    ],
  });
  assert.ok(ip.ok);
  assert.match(render(ip, () => undefined)[0]!.content, /::1\/128/);
  const result = compileProfile({
    target: { engine: "surge", platform: "ios", version: "5.21.0" },
    proxies: [],
    groups: [],
    routes: [defineRoute({ when: match.not(match.processName("App")), to: outbound.direct })],
    fallback: outbound.direct,
  });
  assert.equal(result.ok, false);
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("proxyId retains the published consumer algorithm and case", () => {
  for (const provider of ["WestData", "westdata", "v2tun"])
    assert.equal(
      proxyId(provider, "🇭🇰 WD-香港-01"),
      `node-${createHash("sha256")
        .update(JSON.stringify([provider, "🇭🇰 WD-香港-01"]))
        .digest("hex")
        .slice(0, 16)}`,
    );
  assert.notEqual(proxyId("WestData", "a"), proxyId("westdata", "a"));
  assert.throws(() => proxyId("", "a"), /INVALID_PROXY_ID_INPUT/);
});

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("DNS functions preserve batch order and compile identically to data", () => {
  const patterns = ["*.EXAMPLE.com", "example.com"];
  const server = "https://1.1.1.1/dns-query";
  const expected = patterns.map((pattern) => ({ pattern, server }));
  const rules = dnsRule(patterns, server);
  patterns.reverse();
  assert.deepEqual(rules, expected);
  assert.deepEqual(dnsRule("example.com", server), expected[1]);
  assert.deepEqual(dnsRule([], server), []);
  const a = compileProfile(fixture(rules));
  const b = compileProfile(fixture(expected));
  assert.ok(a.ok && a.engine === "sing-box" && b.ok && b.engine === "sing-box");
  assert.deepEqual(
    render(a.compilation, () => undefined),
    render(b.compilation, () => undefined),
  );
  assert.throws(() => dnsRule(["EXAMPLE.com", "example.com"], server), /INVALID_DNS_RULE/);
  assert.throws(
    () =>
      dnsRule(
        Array.from({ length: 2001 }, (_, i) => `a${i}.com`),
        server,
      ),
    /INVALID_DNS_RULE/,
  );
  assert.throws(() => dnsRule("*example.com", server), /INVALID_DNS_RULE/);
  let reads = 0;
  const unsafe = ["example.com"];
  Object.defineProperty(unsafe, 0, {
    get() {
      reads++;
      return "example.com";
    },
  });
  assert.throws(() => dnsRule(unsafe, server));
  assert.equal(reads, 0);
});

// @feature docs/feature/target-compilation/portable-authoring.md
test("Surge merges portable DNS and native Host fragments without overwriting", () => {
  const input = {
    ...fixture([{ pattern: "lan.example", server: "192.0.2.53" }]),
    target: { engine: "surge", platform: "macos", version: "6.10.0" } as const,
    singBox: undefined,
    surge: { hosts: [[{ pattern: "edge.example", address: "alias.example" }]] },
  };
  const result = compileProfile(input);
  assert.ok(result.ok && result.engine === "surge", JSON.stringify(result));
  const output = renderSurgeProfile(result.compilation, () => undefined).content;
  assert.match(output, /lan.example = server:192.0.2.53\nedge.example = alias.example/);
  assert.throws(
    () =>
      defineProfile({
        ...input,
        surge: { hosts: [{ pattern: "LAN.example", address: "192.0.2.1" }] },
      }),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, "DNS_HOSTS_CONFLICT");
      assert.deepEqual((error as { paths: string[] }).paths, ["dns[0]", "surge.hosts[0]"]);
      return true;
    },
  );
});

// @feature docs/feature/target-compilation/portable-authoring.md
test("combined Host limits and conflict paths survive plain profile checks", () => {
  const input = {
    ...fixture([{ pattern: "edge.example", server: "1.1.1.1" }]),
    target: { engine: "surge", platform: "macos", version: "6.10.0" } as const,
    singBox: undefined,
    surge: { hosts: [{ pattern: "EDGE.example", server: "1.1.1.1" }] },
  };
  const checked = checkBuild({ profiles: { mac: input } });
  assert.equal(checked.code, "DNS_HOSTS_CONFLICT");
  assert.deepEqual(checked.profiles[0]?.paths, ["dns[0]", "surge.hosts[0]"]);
  const hosts = Array.from({ length: 2000 }, (_, i) => ({
    pattern: `host${i}.example`,
    address: "192.0.2.1",
  }));
  assert.equal(compileProfile({ ...input, surge: { hosts } }).ok, false);
  assert.equal(compileProfile({ ...input, surge: { hosts: hosts.slice(1) } }).ok, true);
});
