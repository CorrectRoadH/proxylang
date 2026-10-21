import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  buildToDirectory,
  compile,
  compileStrategyGroups,
  direct,
  explain,
  group,
  match as m,
  policy,
  reject,
  render,
  route,
  rule,
  secret,
  slot,
  strategy,
  surge,
  use,
  type Config,
  type Match,
  type Program,
} from "../src/index.js";
import { trojan } from "./fixtures.js";

const engines = ["mihomo", "stash"] as const;
type ClashEngine = (typeof engines)[number];
function fixture(engine: ClashEngine, overrides: Partial<Program> = {}): Config {
  return {
    programs: {
      home: { engine, nodes: [trojan], groups: [], routing: [], fallback: direct(), ...overrides },
    },
    targets: [
      {
        id: engine,
        program: "home",
        engine,
        version: engine === "mihomo" ? "1.19.32" : "4.2.1",
        platform: "macos",
      },
    ],
  };
}
function output(config: Config) {
  const compiled = compile(config);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const artifact = render(compiled, () => "test-only")[0]!;
  assert.match(artifact.filename, /\.ya?ml$/);
  return { compiled, yaml: parse(artifact.content) };
}
function hasError(input: unknown, code: string) {
  const result = compile(input);
  assert.equal(result.ok, false);
  assert.deepEqual(result.plans, []);
  assert.ok(
    result.diagnostics.some((d) => d.code === code && d.severity === "error"),
    JSON.stringify(result.diagnostics),
  );
}

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test("精确引擎版本与平台目录，不把 Stash 当作 Mihomo", () => {
  for (const engine of engines) {
    const config = fixture(engine);
    output(config);
    hasError(
      { ...config, targets: [{ ...config.targets[0], version: "1.0.0" }] },
      "UNKNOWN_TARGET",
    );
  }
  const mihomo = fixture("mihomo");
  output({ ...mihomo, targets: [{ ...mihomo.targets[0]!, platform: "linux" }] });
  const stash = fixture("stash");
  hasError({ ...stash, targets: [{ ...stash.targets[0], platform: "linux" }] }, "UNKNOWN_TARGET");
  hasError(
    {
      ...stash,
      targets: [{ ...stash.targets[0], mode: "standalone" }],
      programs: {
        home: { ...stash.programs.home, listener: { port: 16080, resolver: "1.1.1.1" } },
      },
    },
    "MODE_UNSUPPORTED",
  );
});

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test("共享 policy 保留首命中顺序、出口绑定和来源映射", () => {
  const shared = policy({
    id: "shared",
    exits: ["egress"],
    rules: [
      rule("first", m.domain("example.com"), reject()),
      rule("second", m.domainSuffix("example.com"), slot("egress")),
    ],
  });
  const programs = Object.fromEntries(
    engines.map((engine) => [
      engine,
      fixture(engine, {
        routing: [use(shared, { id: "instance", bindings: { egress: route("edge") } })],
      }).programs.home!,
    ]),
  );
  const config: Config = {
    programs,
    targets: engines.map((engine) => ({ ...fixture(engine).targets[0]!, program: engine })),
  };
  const compiled = compile(config);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const artifacts = render(compiled, () => "test-only");
  for (const plan of compiled.plans) {
    assert.deepEqual(
      plan.rules.map((r) => r.id),
      [`${plan.target.program}/instance/first`, `${plan.target.program}/instance/second`],
    );
    assert.deepEqual(
      plan.sourceMap.map((s) => s.nativeIndex),
      [0, 1],
    );
    assert.deepEqual(
      plan.sourceMap.map((s) => s.origin),
      [
        ["use:instance", "policy:shared", "first"],
        ["use:instance", "policy:shared", "second"],
      ],
    );
    assert.equal(plan.nativeValidation, "not-run");
    assert.equal(
      explain(compiled, plan.target.id, { network: "tcp", domain: "example.com" }).action.type,
      "reject",
    );
    assert.deepEqual(
      explain(compiled, plan.target.id, { network: "tcp", domain: "www.example.com" }).action,
      route("edge"),
    );
  }
  for (const artifact of artifacts) {
    const yaml = parse(artifact.content);
    assert.deepEqual(yaml.rules, [
      "DOMAIN,example.com,REJECT",
      "DOMAIN-SUFFIX,example.com,edge",
      "MATCH,DIRECT",
    ]);
    for (const key of [
      "mixed-port",
      "bind-address",
      "allow-lan",
      "dns",
      "tun",
      "external-controller",
    ])
      assert.equal(Object.hasOwn(yaml, key), false, key);
  }
});

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test("独立策略键选择算法，缺失实现与专属算法不会回退", () => {
  const adaptive = strategy({
    id: "adaptive",
    members: ["edge"],
    implementations: {
      mihomo: group.urltest({ url: "https://example.com/check?x=1&y=2" }),
      stash: group.select(),
    },
  });
  for (const engine of engines) {
    const { compiled, yaml } = output(fixture(engine, { groups: [adaptive] }));
    assert.equal(compiled.plans[0]!.strategySelections[0]!.engine, engine);
    assert.equal(
      compiled.plans[0]!.strategySelections[0]!.algorithm.type,
      engine === "mihomo" ? "urltest" : "select",
    );
    assert.deepEqual(yaml["proxy-groups"][0].proxies, ["edge"]);
    if (engine === "mihomo")
      assert.deepEqual(yaml["proxy-groups"][0], {
        name: "adaptive",
        type: "url-test",
        proxies: ["edge"],
        url: "https://example.com/check?x=1&y=2",
        interval: 180,
        tolerance: 50,
      });
    else assert.equal(yaml["proxy-groups"][0].type, "select");
    hasError(
      fixture(engine, {
        groups: [strategy({ ...adaptive, implementations: { surge: group.select() } })],
      }),
      "STRATEGY_IMPLEMENTATION_MISSING",
    );
    hasError(
      fixture(engine, {
        groups: [strategy({ ...adaptive, implementations: { [engine]: surge.smart() } })],
      }),
      "ALGORITHM_ENGINE_MISMATCH",
    );
  }
  for (const candidate of [
    { id: "auto", type: "urltest" as const, members: ["edge"], url: "https://example.com/test" },
    strategy({
      id: "auto",
      members: ["edge"],
      implementations: { stash: group.urltest({ url: "https://example.com/test" }) },
    }),
  ])
    hasError(fixture("stash", { groups: [candidate] }), "GROUP_UNSUPPORTED");
});

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test("Stash 来源与范围条件在顶层和所有逻辑组合中整批拒绝", () => {
  const unsupported = [
    m.sourceIp("192.0.2.0/24"),
    m.sourcePort(12345),
    m.sourcePort(1000, 2000),
    m.port(1000, 2000),
  ];
  const wrappers: ((condition: Match) => Match)[] = [
    (c) => c,
    (c) => m.not(c),
    (c) => m.all(m.network("tcp"), c),
    (c) => m.any(m.domain("example.com"), m.not(m.all(m.network("udp"), c))),
  ];
  for (const condition of unsupported)
    for (const wrap of wrappers) {
      const stash = fixture("stash", { routing: [rule("bad", wrap(condition), direct())] });
      const good = fixture("mihomo");
      hasError(
        {
          programs: { ...stash.programs, good: good.programs.home },
          targets: [{ ...good.targets[0]!, program: "good" }, ...stash.targets],
        },
        "MATCH_UNSUPPORTED",
      );
    }
  const { yaml } = output(fixture("stash", { routing: [rule("port", m.port(443), direct())] }));
  assert.deepEqual(yaml.rules, ["DST-PORT,443,DIRECT", "MATCH,DIRECT"]);
});

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test("Mihomo 原子与嵌套 AND OR NOT 保留 no-resolve 位置及闭区间", () => {
  const { yaml } = output(
    fixture("mihomo", {
      routing: [
        rule("v4", m.ipCidr("192.0.2.0/24"), direct()),
        rule("v6", m.ipCidr("2001:db8::/32"), reject()),
        rule(
          "nested",
          m.all(m.network("tcp"), m.any(m.ipCidr("10.0.0.0/8"), m.not(m.ipCidr("fd00::/8")))),
          route("edge"),
        ),
        rule("source", m.sourceIp("fd00::/8"), direct()),
        rule("source-port", m.sourcePort(1000, 2000), direct()),
        rule("port", m.port(3000, 4000), direct()),
      ],
    }),
  );
  assert.deepEqual(yaml.rules, [
    "IP-CIDR,192.0.2.0/24,DIRECT,no-resolve",
    "IP-CIDR6,2001:db8::/32,REJECT,no-resolve",
    "AND,((NETWORK,tcp),(OR,((IP-CIDR,10.0.0.0/8,no-resolve),(NOT,((IP-CIDR6,fd00::/8,no-resolve)))))),edge",
    "SRC-IP-CIDR,fd00::/8,DIRECT",
    "SRC-PORT,1000-2000,DIRECT",
    "DST-PORT,3000-4000,DIRECT",
    "MATCH,DIRECT",
  ]);
});

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test("节点协议、via 与特殊秘密通过真实 YAML 往返且不关闭 TLS 验证", () => {
  const password = "001: 'quoted', \"double\"\nnext: [not-a-node]\n# comment\\end";
  const username = "user: 'name',\nsecond line";
  for (const engine of engines) {
    const config = fixture(engine, {
      nodes: [
        trojan,
        {
          ...trojan,
          id: "http",
          type: "http",
          serverName: undefined,
          username: secret("USER"),
          via: "relay",
        },
        { ...trojan, id: "anytls", type: "anytls", via: "relay" },
      ],
      groups: [{ id: "relay", type: "select", members: ["edge"] }],
      routing: [
        rule("http", m.network("tcp"), route("http")),
        rule("anytls", m.network("tcp"), route("anytls")),
      ],
      fallback: reject(),
    });
    const compiled = compile(config);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    const yaml = parse(
      render(compiled, (token) => (token.name === "USER" ? username : password))[0]!.content,
    );
    assert.deepEqual(
      yaml.proxies.map((n: { type: string }) => n.type),
      ["trojan", "http", "anytls"],
    );
    assert.equal(yaml.proxies.length, 3);
    for (const node of yaml.proxies) {
      assert.equal(node.password, password);
      assert.notEqual(node["skip-cert-verify"], true);
    }
    assert.equal(yaml.proxies[0].sni, "edge.example");
    assert.equal(yaml.proxies[0].udp, true);
    assert.equal(yaml.proxies[1].username, username);
    assert.equal(yaml.proxies[1]["dialer-proxy"], "relay");
    assert.equal(yaml.proxies[2]["dialer-proxy"], "relay");
    if (engine === "stash") {
      assert.equal(yaml.proxies[0]["block-quic"], "off");
      assert.ok(compiled.plans[0]!.preconditions.some((p) => /QUIC/i.test(p)));
      assert.equal(compiled.plans[0]!.nativeValidation, "not-run");
    }
  }
});

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test("UDP 不得走 HTTP AnyTLS 或含 TCP-only 的组和 via 路径；循环与缺失依赖拒绝", () => {
  for (const engine of engines) {
    for (const type of ["http", "anytls"] as const) {
      const nodes = [
        { ...trojan, id: "hop", type, ...(type === "http" ? { serverName: undefined } : {}) },
        { ...trojan, via: "hop" },
      ];
      const groups = [{ id: "relay", type: "select" as const, members: ["edge"] }];
      hasError(
        fixture(engine, {
          nodes,
          groups,
          routing: [rule("udp", m.network("udp"), route("relay"))],
        }),
        "NETWORK_UNSUPPORTED",
      );
      hasError(fixture(engine, { nodes, groups, fallback: route("relay") }), "NETWORK_UNSUPPORTED");
      output(
        fixture(engine, {
          nodes,
          groups,
          routing: [rule("tcp", m.not(m.network("udp")), route("relay"))],
        }),
      );
    }
    hasError(fixture(engine, { nodes: [{ ...trojan, via: "missing" }] }), "MISSING_REFERENCE");
    hasError(
      fixture(engine, {
        nodes: [{ ...trojan, via: "relay" }],
        groups: [{ id: "relay", type: "select", members: ["edge"] }],
      }),
      "RESOURCE_CYCLE",
    );
  }
});

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test("策略片段是 proxy-groups 映射，保持名称顺序并拒绝内建名与冲突", () => {
  for (const engine of engines) {
    const input = {
      target: { engine, platform: "macos", version: engine === "mihomo" ? "1.19.32" : "4.2.1" },
      nodes: [
        { id: "edge", nativeName: "🇯🇵 Tokyo 01" },
        { id: "backup", nativeName: "Backup" },
      ],
      strategies: [
        strategy({
          id: "auto",
          members: ["backup", "edge"],
          implementations: { mihomo: group.select(), stash: group.select() },
        }),
      ],
      names: { auto: "Manual choice" },
    };
    const result = compileStrategyGroups(input);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.artifactKind, "strategy-groups");
    const yaml = parse(result.content!);
    assert.deepEqual(Object.keys(yaml), ["proxy-groups"]);
    assert.deepEqual(yaml["proxy-groups"], [
      { name: "Manual choice", type: "select", proxies: ["Backup", "🇯🇵 Tokyo 01"] },
    ]);
    const reserved = [
      "DIRECT",
      "REJECT",
      "GLOBAL",
      "PASS",
      "COMPATIBLE",
      "REJECT-DROP",
      ...(engine === "mihomo" ? ["PASS-RULE"] : []),
    ];
    for (const name of reserved.flatMap((s) => [s, s.toLowerCase()]))
      for (const bad of [
        { ...input, names: { auto: name } },
        { ...input, nodes: [{ id: "edge", nativeName: name }, input.nodes[1]] },
      ]) {
        const failure = compileStrategyGroups(bad);
        assert.equal(failure.ok, false, name);
        assert.equal(failure.content, null);
        assert.deepEqual(failure.selections, []);
      }
    assert.equal(compileStrategyGroups({ ...input, names: { auto: "Backup" } }).ok, false);
  }
});

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test("策略片段入口保留 Mihomo 显式测速参数，Stash 同一算法拒绝", () => {
  const input = {
    target: { engine: "mihomo", platform: "linux", version: "1.19.32" },
    nodes: [{ id: "edge", nativeName: "Edge" }],
    strategies: [
      strategy({
        id: "auto",
        members: ["edge"],
        implementations: {
          mihomo: group.urltest({
            url: "http://example.com/check",
            intervalSeconds: 45,
            toleranceMs: 0,
          }),
          stash: group.urltest({
            url: "http://example.com/check",
            intervalSeconds: 45,
            toleranceMs: 0,
          }),
        },
      }),
    ],
  };
  const result = compileStrategyGroups(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const yaml = parse(result.content!);
  assert.deepEqual(Object.keys(yaml), ["proxy-groups"]);
  assert.deepEqual(yaml["proxy-groups"][0], {
    name: "auto",
    type: "url-test",
    proxies: ["Edge"],
    url: "http://example.com/check",
    interval: 45,
    tolerance: 0,
  });
  const failure = compileStrategyGroups({
    ...input,
    target: { engine: "stash", platform: "macos", version: "4.2.1" },
  });
  assert.equal(failure.ok, false);
  assert.ok(failure.diagnostics.some((d) => d.code === "GROUP_UNSUPPORTED"));
  assert.equal(failure.content, null);
  assert.deepEqual(failure.selections, []);
});

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test("Mihomo standalone 固定内部直连 DNS，禁用 hosts 且不增加 DNS 或系统入口", () => {
  const config = fixture("mihomo", { listener: { port: 16080, resolver: "2001:db8::53" } });
  const { yaml } = output({ ...config, targets: [{ ...config.targets[0]!, mode: "standalone" }] });
  assert.equal(yaml["mixed-port"], 16080);
  assert.equal(yaml.mode, "rule");
  assert.equal(yaml["allow-lan"], false);
  assert.equal(yaml["bind-address"], "127.0.0.1");
  assert.equal(yaml.dns.enable, true);
  assert.equal(yaml.dns["enhanced-mode"], "redir-host");
  assert.deepEqual(yaml.dns.nameserver, ["2001:db8::53"]);
  assert.deepEqual(yaml.dns["default-nameserver"], ["2001:db8::53"]);
  assert.equal(yaml.dns["respect-rules"], false);
  assert.equal(yaml.dns["use-hosts"], false);
  assert.equal(yaml.dns["use-system-hosts"], false);
  assert.equal(yaml.dns.ipv6, false);
  assert.equal(Object.hasOwn(yaml.dns, "listen"), false);
  assert.equal(yaml.sniffer.enable, false);
  assert.equal(yaml["geo-auto-update"], false);
  for (const key of [
    "external-controller",
    "tun",
    "listeners",
    "proxy-providers",
    "rule-providers",
  ])
    assert.equal(Object.hasOwn(yaml, key), false, key);
});

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test("真实 build 批次后续秘密失败或能力失败保留 active 与旧 YAML", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-clash-build-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const mihomo = fixture("mihomo");
  const stash = fixture("stash", { nodes: [{ ...trojan, password: secret("LATER_PASSWORD") }] });
  const config: Config = {
    programs: { mihomo: mihomo.programs.home!, stash: stash.programs.home! },
    targets: engines.map((engine) => ({ ...fixture(engine).targets[0]!, program: engine })),
  };
  const compiled = compile(config);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const first = await buildToDirectory(compiled, root, () => "first-secret");
  assert.equal(first.published, true);
  const active = await readFile(join(root, "active.json"), "utf8");
  const pointer = JSON.parse(active);
  const originals = await Promise.all(
    Object.values(pointer.artifacts as Record<string, string>).map((path) =>
      readFile(join(root, path), "utf8"),
    ),
  );
  const failed = await buildToDirectory(compiled, root, (token) =>
    token.name === "LATER_PASSWORD" ? undefined : "new-secret",
  );
  assert.equal(failed.published, false);
  assert.equal(failed.code, "SECRET_MISSING");
  const invalid = compile({
    ...config,
    programs: {
      ...config.programs,
      stash: {
        ...config.programs.stash!,
        routing: [rule("unsupported", m.sourceIp("192.0.2.0/24"), direct())],
      },
    },
  });
  assert.equal(invalid.ok, false);
  assert.equal(
    (
      await buildToDirectory(invalid, root, () => {
        throw new Error("must not resolve");
      })
    ).code,
    "COMPILATION_FAILED",
  );
  assert.equal(await readFile(join(root, "active.json"), "utf8"), active);
  assert.equal((await readdir(join(root, "generations"))).length, 1);
  assert.equal((await readdir(root)).includes(".proxylang-lock"), false);
  const retained = await Promise.all(
    Object.values(pointer.artifacts as Record<string, string>).map((path) =>
      readFile(join(root, path), "utf8"),
    ),
  );
  assert.deepEqual(retained, originals);
  for (const content of retained) assert.equal(parse(content).proxies[0].password, "first-secret");
});
