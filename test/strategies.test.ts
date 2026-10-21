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
