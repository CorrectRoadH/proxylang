import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  compile,
  compileStrategyGroups,
  group,
  match,
  render,
  route,
  rule,
  strategy,
  surge,
  type StrategyGroupInput,
} from "../src/index.js";
import { dual, fixture, trojan } from "./fixtures.js";

const auto = strategy({
  id: "auto",
  members: ["edge"],
  implementations: {
    surge: surge.smart(),
    "sing-box": group.urltest({ url: "https://example.com/test" }),
  },
});
const input: StrategyGroupInput = {
  target: { engine: "surge", platform: "macos", version: "6.10.0" },
  nodes: [{ id: "edge", nativeName: "🇯🇵 Tokyo 01" }],
  strategies: [auto],
  names: { auto: "AI Smart" },
};

// @use-case docs/feature/target-compilation/use-case/strategy-implementations.md
test("同一策略按目标选择 Smart / urltest，并隔离计划和输入快照", () => {
  const config = dual(
    fixture([rule("ai", match.domain("example.com"), route("auto"))], { groups: [auto] }),
  );
  const result = compile(config);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    result.plans.map((p) => p.program.groups[0]!.type),
    ["urltest", "surge-smart"],
  );
  assert.deepEqual(
    result.plans.map((p) => p.strategySelections[0]!.algorithm.type),
    ["urltest", "surge-smart"],
  );
  assert.equal(config.programs.home!.groups[0]!.type, "strategy");
  const artifacts = render(result, () => "test-only");
  assert.equal(
    JSON.parse(artifacts[0]!.content).outbounds.find((o: { tag: string }) => o.tag === "auto").type,
    "urltest",
  );
  assert.match(artifacts[1]!.content, /auto = smart, edge/);
  assert.ok(Object.isFrozen(result.plans[0]!.strategySelections[0]!.algorithm));
  assert.ok(Object.isFrozen(result.plans[0]!.program.groups));
});

// @use-case docs/feature/target-compilation/use-case/strategy-implementations.md
test("所有分支做结构校验，所选分支不能缺失、跨引擎或静默降级", () => {
  const cases = [
    [
      strategy({ ...auto, implementations: { surge: surge.smart() } }),
      "STRATEGY_IMPLEMENTATION_MISSING",
    ],
    [
      strategy({ ...auto, implementations: { "sing-box": surge.smart() } }),
      "ALGORITHM_ENGINE_MISMATCH",
    ],
    [
      {
        ...auto,
        implementations: { ...auto.implementations, surge: { type: "urltest", url: "not-a-url" } },
      },
      "INVALID_SCHEMA",
    ],
  ] as const;
  for (const [value, code] of cases) {
    const result = compile({
      ...fixture(),
      programs: { home: { ...fixture().programs.home!, groups: [value] } },
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some((d) => d.code === code),
      JSON.stringify(result.diagnostics),
    );
  }
  const unsupported = compileStrategyGroups({
    ...input,
    strategies: [
      strategy({
        ...auto,
        implementations: { surge: group.urltest({ url: "https://example.com" }) },
      }),
    ],
  });
  assert.ok(unsupported.diagnostics.some((d) => d.code === "GROUP_UNSUPPORTED"));
});

// @use-case docs/feature/target-compilation/use-case/strategy-implementations.md
test("Smart 不允许嵌套组；策略不能绕过完整编译的 TCP-only 检查", () => {
  const nested = strategy({ ...auto, members: ["relay"] });
  const result = compile(
    dual(fixture([], { groups: [{ id: "relay", type: "select", members: ["edge"] }, nested] })),
  );
  assert.ok(result.diagnostics.some((d) => d.code === "SMART_MEMBER_UNSUPPORTED"));
  const tcp = compile(
    fixture([], {
      nodes: [{ ...trojan, type: "http", serverName: undefined }],
      groups: [auto],
      fallback: route("auto"),
    }),
  );
  assert.equal(tcp.ok, false);
  assert.ok(
    tcp.diagnostics.some((d) => d.code.includes("NETWORK")),
    JSON.stringify(tcp.diagnostics),
  );
});

// @use-case docs/feature/target-compilation/use-case/strategy-implementations.md
test("专用入口只产生标记过的组片段，保留节点名称与次序", () => {
  const result = compileStrategyGroups(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.artifactKind, "strategy-groups");
  assert.equal(result.content, "AI Smart = smart, 🇯🇵 Tokyo 01\n");
  const box = compileStrategyGroups({
    ...input,
    target: { engine: "sing-box", version: "1.12.0", platform: "linux" },
  });
  assert.equal(JSON.parse(box.content!)[0].type, "urltest");
  assert.deepEqual(JSON.parse(box.content!)[0].outbounds, ["🇯🇵 Tokyo 01"]);
  assert.ok(Object.isFrozen(box.selections));
});

// @use-case docs/feature/target-compilation/use-case/strategy-implementations.md
test("名字注入、最终名字冲突、保留字与未知映射均拒绝", () => {
  for (const nativeName of [
    "",
    " ",
    " AI",
    "AI ",
    "DIRECT",
    "direct",
    "REJECT",
    "pl-test",
    "AI\nREJECT",
    "a,b",
    "a=b",
    "a#b",
    "a;b",
    "a[b",
    "a(b",
    "a\u200bb",
    "a\u2028b",
    "a\u2029b",
  ]) {
    const result = compileStrategyGroups({ ...input, names: { auto: nativeName } });
    assert.equal(result.ok, false, JSON.stringify(nativeName));
    assert.equal(result.content, null);
    assert.deepEqual(result.selections, []);
  }
  assert.equal(compileStrategyGroups({ ...input, names: { auto: "🇯🇵 Tokyo 01" } }).ok, false);
  assert.equal(compileStrategyGroups({ ...input, names: { missing: "Unknown" } }).ok, false);
  assert.equal(
    compileStrategyGroups({ ...input, nodes: [{ id: "edge", nativeName: "auto" }], names: {} }).ok,
    false,
  );
  assert.equal(
    compileStrategyGroups({
      ...input,
      strategies: [strategy({ ...auto, id: "direct" })],
      names: {},
    }).ok,
    false,
  );
});

// @use-case docs/feature/target-compilation/use-case/strategy-implementations.md
test("专用入口严格验证版本、资源引用、重复、循环和空组", () => {
  const failures = [
    { ...input, target: { ...input.target, version: "6.9.0" } },
    { ...input, target: { ...input.target, platform: "ios" } },
    { ...input, nodes: [] },
    { ...input, nodes: [...input.nodes, ...input.nodes] },
    { ...input, strategies: [strategy({ ...auto, members: [] })] },
    {
      ...input,
      strategies: [
        strategy({ ...auto, members: ["auto"], implementations: { surge: group.select() } }),
      ],
    },
    { ...input, strategies: [strategy({ ...auto, members: ["auto"] })] },
  ];
  for (const value of failures) {
    const result = compileStrategyGroups(value);
    assert.equal(result.ok, false);
    assert.equal(result.content, null);
  }
});

// @use-case docs/feature/target-compilation/use-case/strategy-implementations.md
test("通用 auto 按精确目标生成实现，保留意图与不可变选择证据", () => {
  const portable = strategy({ id: "auto", members: ["edge"], algorithm: group.auto() });
  for (const [engine, version, expected] of [
    ["surge", "6.10.0", "surge-smart"],
    ["sing-box", "1.11.0", "urltest"],
    ["sing-box", "1.12.0", "urltest"],
    ["mihomo", "1.19.32", "urltest"],
  ] as const) {
    const target = { engine, version, platform: "macos" as const };
    const fragment = compileStrategyGroups({ ...input, target, strategies: [portable] });
    assert.equal(fragment.ok, true, JSON.stringify(fragment.diagnostics));
    const base = fixture([], { groups: [portable] });
    const full = compile({
      ...base,
      programs: { home: { ...base.programs.home!, engine } },
      targets: [{ ...target, id: "native", program: "home" }],
    });
    assert.equal(full.ok, true, JSON.stringify(full.diagnostics));
    assert.deepEqual(full.plans[0]!.strategySelections, fragment.selections);
    const selection = fragment.selections[0]!;
    assert.equal(selection.algorithm.type, expected);
    assert.deepEqual(selection.requestedAlgorithm, { type: "auto" });
    assert.equal(selection.implementationSource, "default");
    assert.ok(Object.isFrozen(selection.requestedAlgorithm));
    if (selection.algorithm.type === "urltest") {
      assert.equal(selection.algorithm.intervalSeconds, 180);
      assert.equal(selection.algorithm.toleranceMs, 50);
      assert.equal(selection.algorithm.url, "https://www.gstatic.com/generate_204");
    }
    assert.equal(render(full, () => "test-only").length, 1);
  }
  for (const target of [
    { engine: "stash", version: "4.2.1", platform: "macos" },
    { engine: "surge", version: "6.10.1", platform: "macos" },
    { engine: "surge", version: "6.10.0", platform: "linux" },
  ])
    assert.equal(compileStrategyGroups({ ...input, target, strategies: [portable] }).ok, false);
});

// @use-case docs/feature/target-compilation/use-case/strategy-implementations.md
test("通用算法覆写约束包含未选分支，固定 URLTest 不被弱化", () => {
  const compileAlgorithm = (algorithm: unknown, implementations?: unknown) =>
    compileStrategyGroups({
      ...input,
      strategies: [{ type: "strategy", id: "auto", members: ["edge"], algorithm, implementations }],
    });
  const custom = group.urltest({
    url: "https://example.com/probe",
    intervalSeconds: 60,
    toleranceMs: 0,
  });
  const selected = compileAlgorithm(group.auto(), { surge: surge.smart(), "sing-box": custom });
  assert.equal(selected.ok, true);
  assert.equal(selected.selections[0]!.implementationSource, "override");
  for (const [requested, implementations] of [
    [group.auto(), { "sing-box": group.select() }],
    [group.select(), { "sing-box": custom }],
    [custom, { surge: surge.smart() }],
    [custom, { "sing-box": { ...custom, intervalSeconds: 61 } }],
    [custom, { "sing-box": { ...custom, toleranceMs: 1 } }],
    [custom, { "sing-box": { ...custom, url: "https://example.com/other" } }],
  ]) {
    const result = compileAlgorithm(requested, implementations);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((d) => d.code === "ALGORITHM_CONTRACT_MISMATCH"));
    assert.equal(result.content, null);
  }
  assert.ok(compileAlgorithm(custom).diagnostics.some((d) => d.code === "GROUP_UNSUPPORTED"));
  const box = { ...input, target: { engine: "sing-box", version: "1.12.0", platform: "linux" } };
  const urltest = group.urltest({ url: "https://example.com/probe" });
  const normalized = compileStrategyGroups({
    ...box,
    strategies: [
      strategy({
        id: "auto",
        members: ["edge"],
        algorithm: urltest,
        implementations: { "sing-box": { ...urltest, intervalSeconds: 180, toleranceMs: 50 } },
      }),
    ],
  });
  assert.equal(normalized.ok, true);
  assert.deepEqual(
    normalized.selections[0]!.requestedAlgorithm,
    normalized.selections[0]!.algorithm,
  );
  assert.equal(compileAlgorithm(group.select()).ok, true);
  const legacy = compileStrategyGroups(input).selections[0]!;
  assert.equal(Object.hasOwn(legacy, "requestedAlgorithm"), false);
  assert.equal(Object.hasOwn(legacy, "implementationSource"), false);
});

// @use-case docs/feature/target-compilation/use-case/strategy-implementations.md
test("公共语法严格拒绝未知调优字段、空声明和 Smart 冒充，保留成员限制", () => {
  for (const value of [
    { type: "strategy", id: "auto", members: ["edge"] },
    { type: "strategy", id: "auto", members: ["edge"], implementations: {} },
    strategy({ id: "auto", members: ["edge"], algorithm: { type: "auto", interval: 3 } as never }),
    strategy({ id: "auto", members: ["edge"], algorithm: surge.smart() as never }),
    strategy({
      id: "auto",
      members: ["edge"],
      algorithm: group.auto(),
      implementations: { surge: { type: "surge-smart", priority: 1 } as never },
    }),
  ]) {
    const result = compileStrategyGroups({ ...input, strategies: [value] });
    assert.ok(result.diagnostics.some((d) => d.code === "INVALID_SCHEMA"));
  }
  const nested = compileStrategyGroups({
    ...input,
    strategies: [
      strategy({ id: "child", members: ["edge"], algorithm: group.select() }),
      strategy({ id: "auto", members: ["child"], algorithm: group.auto() }),
    ],
  });
  assert.ok(nested.diagnostics.some((d) => d.code === "SMART_MEMBER_UNSUPPORTED"));
});
