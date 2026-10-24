import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  compile,
  direct,
  match as m,
  policy,
  render,
  reject,
  route,
  rule,
  selectNodes,
  use,
  type Config,
} from "../src/index.js";
import { dual, fixture, trojan } from "./fixtures.js";

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("schema 诊断定位嵌套字段并解释约束，不回显非法值或额外键", () => {
  const config = fixture([rule("port", m.port(70000), direct())]);
  const result = compile(config);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (d) => d.path === "programs.home.routing.0.when.from" && d.message.includes("65535"),
    ),
  );
  assert.ok(result.diagnostics.every((d) => d.code === "INVALID_SCHEMA"));
  assert.ok(!JSON.stringify(result).includes("70000"));
  const hidden = "secret-marker-do-not-print";
  const invalid = compile(
    fixture([
      {
        type: "rule",
        id: "broken",
        when: { type: "network", value: hidden },
        then: direct(),
      },
    ] as unknown as Parameters<typeof fixture>[0]),
  );
  assert.ok(
    invalid.diagnostics.some((d) => d.path.endsWith("when.value") && d.message.includes("tcp")),
  );
  assert.ok(!JSON.stringify(invalid).includes(hidden));
  const extra = compile({ ...fixture(), [hidden]: hidden });
  assert.ok(extra.diagnostics.some((d) => d.message.includes("额外字段")));
  assert.ok(!JSON.stringify(extra).includes(hidden));
});

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("精确版本、平台和引擎检查；任何失败不暴露部分计划", () => {
  for (const override of [{ version: "1.12.1" }, { engine: "surge" }, { platform: "windows" }]) {
    const config = dual(fixture());
    const result = compile({
      ...config,
      targets: [{ ...config.targets[0], ...override }, config.targets[1]],
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.plans, []);
  }
  assert.equal(
    compile({
      ...fixture(),
      targets: [
        { id: "mac", program: "home", engine: "surge", version: "6.10.0", platform: "linux" },
      ],
    }).ok,
    false,
  );
});

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("协议和组能力不做隐式替换", () => {
  const anytls = fixture([rule("tcp", m.network("tcp"), route("edge"))], {
    nodes: [{ ...trojan, type: "anytls" }],
  });
  assert.equal(compile(anytls).ok, true);
  assert.ok(
    compile({ ...anytls, targets: [{ ...anytls.targets[0], version: "1.11.0" }] }).diagnostics.some(
      (d) => d.code === "PROTOCOL_UNSUPPORTED",
    ),
  );
  const smart = fixture([], { groups: [{ id: "smart", type: "smart", members: ["edge"] }] });
  assert.ok(compile(smart).diagnostics.some((d) => d.code === "GROUP_UNSUPPORTED"));
  const auto = fixture([], {
    groups: [{ id: "auto", type: "urltest", members: ["edge"], url: "https://example.com/test" }],
  });
  assert.equal(compile(auto).ok, true);
  assert.equal(compile(dual(auto)).ok, false);
});

// @use-case docs/feature/rule-composition/use-case/select-resources.md
test("组成员与 via 联合依赖循环、缺失引用、重复节点报错", () => {
  const cyclic = fixture([], {
    nodes: [{ ...trojan, via: "relay" }],
    groups: [{ id: "relay", type: "select", members: ["edge"] }],
  });
  assert.ok(compile(cyclic).diagnostics.some((d) => d.code === "RESOURCE_CYCLE"));
  assert.ok(
    compile(fixture([], { nodes: [{ ...trojan, via: "missing" }] })).diagnostics.some(
      (d) => d.code === "MISSING_REFERENCE",
    ),
  );
  assert.ok(
    compile(fixture([rule("missing", m.network("tcp"), route("missing"))])).diagnostics.some(
      (d) => d.code === "MISSING_REFERENCE",
    ),
  );
  assert.ok(
    compile(fixture([], { nodes: [trojan, trojan] })).diagnostics.some(
      (d) => d.code === "DUPLICATE_RESOURCE",
    ),
  );
  const template = policy({
    id: "unused",
    exits: ["unused"],
    rules: [rule("direct", m.network("tcp"), direct())],
  });
  assert.ok(
    compile(
      fixture([use(template, { id: "instance", bindings: { unused: route("missing") } })]),
    ).diagnostics.some((d) => d.code === "MISSING_REFERENCE"),
  );
});

// @use-case docs/feature/rule-composition/use-case/select-resources.md
test("所有可选与 via 路径都参与 TCP-only 推断，not 不能绕过", () => {
  const program = {
    nodes: [
      { ...trojan, id: "hop", type: "http" as const, serverName: undefined },
      { ...trojan, via: "hop" },
    ],
    groups: [{ id: "group", type: "select" as const, members: ["edge"] }],
  };
  const check = (condition: ReturnType<typeof m.network>) =>
    compile(fixture([rule("limited", condition, route("group"))], program));
  assert.equal(check(m.network("tcp")).ok, true);
  assert.equal(check(m.not(m.network("udp"))).ok, true);
  assert.equal(check(m.domain("example.com")).ok, false);
  assert.equal(check(m.not(m.all(m.network("udp"), m.domain("example.com")))).ok, false);
  assert.equal(compile(fixture([], { ...program, fallback: route("group") })).ok, false);
});

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("展示 warning 可提升 error，未知能力永远 error", () => {
  const config = fixture([], { nodes: [{ ...trojan, label: "Demo display" }] });
  const result = compile(config);
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics[0]!.severity, "warning");
  const strict = compile({ ...config, warningsAsErrors: true });
  assert.equal(strict.ok, false);
  assert.equal(strict.diagnostics[0]!.severity, "error");
});

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("逻辑深度检查的是守卫展开后的原生树", () => {
  let condition = m.network("tcp");
  for (let i = 0; i < 11; i++) condition = m.not(condition);
  const result = compile(dual(fixture([rule("deep", condition, direct())])));
  assert.ok(result.diagnostics.some((d) => d.code === "LOGICAL_DEPTH"));
});

// @use-case docs/feature/policy-explanation/use-case/protect-routing.md
test("cases 是首命中与出口回归，不匹配会阻止整批编译", () => {
  const config: Config = {
    ...fixture([rule("first", m.domain("example.com"), reject())]),
    cases: [
      {
        id: "expected",
        program: "home",
        request: { network: "tcp", domain: "example.com" },
        expect: { action: direct() },
      },
    ],
  };
  const result = compile(config);
  assert.equal(result.ok, false);
  assert.equal(result.cases[0]!.passed, false);
  assert.deepEqual(result.plans, []);
});

// @use-case docs/feature/rule-composition/use-case/select-resources.md
test("selectNodes 使用元数据且稳定排序，空组不成立", () => {
  const nodes = [
    { ...trojan, id: "second", region: "SG", tags: ["ai"] },
    { ...trojan, id: "first", region: "US", tags: ["ai"] },
  ];
  assert.deepEqual(selectNodes(nodes, { regions: ["US", "SG"], tags: ["ai"] }), [
    "second",
    "first",
  ]);
  assert.equal(
    compile(fixture([], { groups: [{ id: "empty", type: "select", members: [] }] })).ok,
    false,
  );
});

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("版本专属 DNS 与 urltest 参数显式输出，规则顺序及动作不改变", () => {
  const input = fixture(
    [rule("one", m.any(m.domain("example.com"), m.ipCidr("192.0.2.0/24")), reject())],
    {
      listener: { port: 16080, resolver: "1.1.1.1" },
      groups: [{ id: "auto", type: "urltest", members: ["edge"], url: "https://example.com/test" }],
      fallback: reject(),
    },
  );
  for (const version of ["1.11.0", "1.12.0"]) {
    const result = compile({
      ...input,
      targets: [{ ...input.targets[0], version, mode: "standalone" }],
    });
    assert.equal(result.ok, true);
    const config = JSON.parse(render(result, () => "dummy")[0]!.content);
    assert.equal(config.dns.servers[0].detour, version === "1.12.0" ? undefined : "pl-direct");
    assert.equal(config.dns.servers[0].type, version === "1.12.0" ? "udp" : undefined);
    assert.equal(config.route.rules[0].type, "logical");
    assert.equal(config.route.rules[0].action, "reject");
    assert.equal(config.route.rules[1].action, "reject");
    assert.equal(config.outbounds[2].interval, "180s");
    assert.equal(config.outbounds[2].tolerance, 50);
  }
});

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("JSON 结构化编码秘密，Surge 拒绝注入，整个批次只解析一次 token", () => {
  const compilation = compile(dual(fixture()));
  let calls = 0;
  assert.equal(
    render(compilation, () => {
      calls++;
      return "safe-token";
    }).length,
    2,
  );
  assert.equal(calls, 1);
  const secret = 'quoted"\n[Rule]\nFINAL,DIRECT';
  const box = JSON.parse(render(compile(fixture()), () => secret)[0]!.content);
  assert.equal(box.outbounds[1].password, secret);
  assert.throws(() => render(compilation, () => secret), {
    message: "SURGE_VALUE_UNREPRESENTABLE",
  });
  assert.throws(
    () =>
      render(compilation, () => {
        throw new Error(secret);
      }),
    { message: "SECRET_RESOLUTION_FAILED" },
  );
  assert.throws(() => render(compilation, () => undefined), { message: "SECRET_MISSING" });
  assert.equal(JSON.stringify(compilation).includes(secret), false);
});
