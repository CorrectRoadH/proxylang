import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  block,
  compile,
  direct,
  explain,
  match as m,
  policy,
  reject,
  route,
  rule,
  sequence,
  slot,
  use,
  type Entry,
  type Match,
  type Request,
} from "../src/index.js";
import { fixture } from "./fixtures.js";

// @use-case docs/feature/rule-composition/use-case/compose-policy.md
test("嵌套守卫、具名实例、外层出口转绑定保持顺序与来源", () => {
  const leaf = policy({
    id: "leaf",
    exits: ["exit"],
    rules: [rule("web", m.domainSuffix("example.com"), slot("exit"))],
  });
  const parent = policy({
    id: "parent",
    exits: ["selected"],
    rules: [use(leaf, { id: "child", bindings: { exit: slot("selected") } })],
  });
  const config = fixture(
    sequence(
      block(
        "lan",
        [use(parent, { id: "one", bindings: { selected: direct() } })],
        m.sourceIp("192.168.1.0/24"),
      ),
      use(parent, { id: "two", bindings: { selected: route("edge") } }),
      rule("later", m.domainSuffix("example.com"), reject()),
    ),
  );
  const compiled = compile(config);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const local = explain(compiled, "box", {
    network: "tcp",
    domain: "example.com",
    sourceIp: "192.168.1.8",
  });
  assert.equal(local.rule, "home/lan/one/child/web");
  assert.deepEqual(local.action, direct());
  const remote = explain(compiled, "box", { network: "tcp", domain: "cdn.example.com" });
  assert.equal(remote.rule, "home/two/child/web");
  assert.deepEqual(remote.action, route("edge"));
  assert.equal(remote.trace.length, 2);
  assert.deepEqual(remote.trace[1]!.origin, [
    "use:two",
    "policy:parent",
    "use:child",
    "policy:leaf",
    "web",
  ]);
  assert.equal(compiled.plans[0]!.sourceMap.length, 3);
});

const matchingCases: [string, Match, Request, boolean][] = [
  ["suffix root", m.domainSuffix("example.com"), { network: "tcp", domain: "example.com" }, true],
  [
    "suffix child",
    m.domainSuffix("example.com"),
    { network: "tcp", domain: "a.example.com" },
    true,
  ],
  [
    "suffix boundary",
    m.domainSuffix("example.com"),
    { network: "tcp", domain: "notexample.com" },
    false,
  ],
  ["exact", m.domain("example.com"), { network: "tcp", domain: "a.example.com" }, false],
  ["IPv4", m.ipCidr("10.2.0.0/16"), { network: "tcp", ip: "10.2.3.4" }, true],
  ["IPv6", m.ipCidr("2001:db8::/32"), { network: "udp", ip: "2001:db8:abcd::1" }, true],
  ["IP family", m.ipCidr("10.0.0.0/8"), { network: "tcp", ip: "::ffff:10.1.1.1" }, false],
  ["no resolve", m.ipCidr("10.0.0.0/8"), { network: "tcp", domain: "example.com" }, false],
  ["source IPv6", m.sourceIp("fd00::/8"), { network: "tcp", sourceIp: "fdab::1" }, true],
  ["closed lower port", m.port(22, 80), { network: "tcp", port: 22 }, true],
  ["closed upper port", m.port(22, 80), { network: "tcp", port: 80 }, true],
  ["source port", m.sourcePort(45000, 46000), { network: "udp", sourcePort: 45144 }, true],
  ["missing atom", m.port(22), { network: "tcp" }, false],
  ["not missing", m.not(m.port(22)), { network: "tcp" }, true],
  [
    "boolean",
    m.all(m.network("tcp"), m.any(m.domain("a.example"), m.not(m.domain("b.example")))),
    { network: "udp", domain: "a.example" },
    false,
  ],
];
// @use-case docs/feature/policy-explanation/use-case/explain-request.md
for (const [name, condition, request, expected] of matchingCases)
  test(`条件语义：${name}`, () => {
    const compiled = compile(fixture([rule("match", condition, reject())]));
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.equal(explain(compiled, "box", request).rule === "home/match", expected);
  });

// @use-case docs/feature/policy-explanation/use-case/explain-request.md
test("同一对象编译后再修改不会改变快照或解释结果", () => {
  const original = { type: "domain" as const, value: "first.example" };
  const compiled = compile(fixture([rule("first", original, reject())]));
  original.value = "second.example";
  assert.equal(
    explain(compiled, "box", { network: "tcp", domain: "first.example" }).rule,
    "home/first",
  );
  assert.ok(Object.isFrozen(compiled.plans[0]!.rules[0]!.when));
});

// @use-case docs/feature/rule-composition/use-case/compose-policy.md
test("缺失、多余、未声明、顶层 slot 与模板资源捕获都拒绝", () => {
  const template = policy({
    id: "template",
    exits: ["exit"],
    rules: [rule("one", m.network("tcp"), slot("exit"))],
  });
  const variants: Entry[] = [
    { type: "use", id: "one", policy: template, bindings: {} },
    { type: "use", id: "one", policy: template, bindings: { exit: direct(), extra: direct() } },
    {
      type: "use",
      id: "one",
      policy: { ...template, rules: [rule("one", m.network("tcp"), slot("undeclared"))] },
      bindings: { exit: direct() },
    },
    rule("top", m.network("tcp"), slot("exit")),
    use(
      { ...template, rules: [rule("one", m.network("tcp"), route("edge"))] },
      { id: "one", bindings: { exit: direct() } },
    ),
  ];
  for (const entry of variants) assert.equal(compile(fixture([entry])).ok, false);
});

// @use-case docs/feature/rule-composition/use-case/compose-policy.md
test("同一路径重复 ID 拒绝，但不同实例内同名规则合法", () => {
  const entry = rule("same", m.network("tcp"), direct());
  assert.ok(
    compile(fixture([entry, entry])).diagnostics.some((d) => d.code === "DUPLICATE_RULE_ID"),
  );
  assert.equal(compile(fixture([block("one", [entry]), block("two", [entry])])).ok, true);
});

// @use-case docs/feature/rule-composition/use-case/compose-policy.md
test("输入循环和 accessor 在 schema 递归之前拒绝", () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.equal(compile(cyclic).diagnostics[0]!.code, "INVALID_INPUT_GRAPH");
  let invoked = false;
  const getter = {
    get programs() {
      invoked = true;
      throw new Error("should not run");
    },
  };
  assert.equal(compile(getter).ok, false);
  assert.equal(invoked, false);
});

// @use-case docs/feature/policy-explanation/use-case/explain-request.md
test("schema 对未知字段、无效条件与错误请求 fail closed", () => {
  for (const condition of [
    m.any(),
    m.all(),
    m.port(99, 1),
    m.domain("*.example.com"),
    m.domain("EXAMPLE.com"),
    m.domain("example.com."),
    m.ipCidr("10.0.0.0/33"),
  ]) {
    assert.equal(compile(fixture([rule("bad", condition, direct())])).ok, false);
  }
  assert.equal(compile({ ...fixture(), surprise: true }).ok, false);
  assert.throws(() => explain(compile(fixture()), "box", { network: "tcp", ip: "bad" }));
});
