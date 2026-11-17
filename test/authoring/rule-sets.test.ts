import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  defineProfile,
  defineBuild,
  checkBuild,
  defineRoutes,
  ruleSet,
  match,
  outbound,
  ProfileDefinitionError,
  surge,
  type Target,
  type Condition,
} from "proxylang";
const target = { engine: "sing-box", version: "1.14.4", platform: "linux" } as const;
const source = (
  id: string,
  options: Partial<NonNullable<Parameters<typeof ruleSet>[0]["singBox"]>> = {},
) =>
  ruleSet({
    id,
    singBox: {
      url: "https://rules.example.com/list.srs",
      format: "binary",
      intervalSeconds: 86400,
      ...options,
    },
  });
const check = (conditions: readonly Condition[], t: Target = target) =>
  checkBuild(
    defineBuild({
      profiles: {
        fixture: defineProfile({
          target: t,
          proxies: [],
          groups: [],
          routes: defineRoutes({ when: conditions, to: outbound.direct }),
          fallback: outbound.direct,
          ...(t.engine === "sing-box" ? { singBox: { mode: "fragment" } } : {}),
        } as never),
      },
    }),
  );
// @feature docs/feature/profile/library/conditions.md#来源冲突与复用
test("same sources deduplicate in route DFS order while per-use matching options are retained", () => {
  const first = source("first"),
    second = source("second", { resolve: true });
  const result = check([match.any(match.domain("example.com"), match.not(first)), second, first]);
  assert.equal(result.ok, true);
  const selections = result.profiles[0]!.selections.filter((s) => s.kind === "ruleSet");
  assert.deepEqual(selections, [
    { kind: "ruleSet", ruleSet: "first", branch: "singBox", nativeName: "first" },
    { kind: "ruleSet", ruleSet: "second", branch: "singBox", nativeName: "first" },
  ]);
  assert.ok(Object.isFrozen(first));
});
// @feature docs/feature/profile/library/conditions.md#来源冲突与复用
for (const field of ["format", "intervalSeconds"] as const)
  test(`same URL with conflicting ${field} fails`, () => {
    const result = check([
      source("one"),
      source("two", field === "format" ? { format: "source" } : { intervalSeconds: 3600 }),
    ]);
    assert.ok(result.profiles[0]!.diagnostics.some((d) => d.code === "RULESET_SOURCE_CONFLICT"));
  });
// @feature docs/feature/profile/library/README.md#规则集
test("ruleSet id identity, missing sources, unsupported engines and missing definitions are distinct errors", () => {
  const a = source("same"),
    b = source("same");
  assert.ok(check([a, b]).profiles[0]!.diagnostics.some((d) => d.code === "DUPLICATE_ID"));
  assert.equal(check([a, a]).ok, true);
  assert.ok(
    check([a], {
      engine: "mihomo",
      platform: "linux",
      version: "1.19.32",
    }).profiles[0]!.diagnostics.some((d) => d.code === "RULESET_SOURCE_MISSING"),
  );
  assert.ok(
    check([a], {
      engine: "stash",
      platform: "macos",
      version: "4.2.1",
    }).profiles[0]!.diagnostics.some((d) => d.code === "RULESET_UNSUPPORTED"),
  );
  assert.throws(
    () => ruleSet({ id: "empty" }),
    (e: unknown) => e instanceof ProfileDefinitionError && e.code === "INVALID_FIELD",
  );
});
// @feature docs/feature/profile/library/conditions.md#来源冲突与复用
test("Surge effective default interval agrees with explicit 86400, while options do not change sources", () => {
  const t = { engine: "surge", platform: "macos", version: "6.10.0" } as const;
  const a = ruleSet({ id: "one", surge: { url: "https://rules.example.com/list.txt" } });
  const b = ruleSet({
    id: "two",
    surge: {
      url: "https://rules.example.com/list.txt",
      intervalSeconds: 86400,
      noResolve: true,
      includeSniffed: true,
    },
  });
  assert.equal(check([a, b], t).ok, true);
  assert.ok(
    check(
      [
        a,
        ruleSet({
          id: "three",
          surge: { url: "https://rules.example.com/list.txt", format: "domain-set" },
        }),
      ],
      t,
    ).profiles[0]!.diagnostics.some((d) => d.code === "RULESET_SOURCE_CONFLICT"),
  );
  assert.ok(
    check([match.not(b)], t).profiles[0]!.diagnostics.some(
      (d) => d.code === "CONDITION_UNSUPPORTED",
    ),
  );
  assert.equal(check([surge.ruleSets.lan, surge.ruleSets.system], t).ok, true);
});
// @feature docs/feature/profile/library/conditions.md#规则集
for (const branch of ["surge", "singBox", "mihomo"] as const)
  test(`${branch} rejects unknown fields and invalid download fields`, () => {
    const valid =
      branch === "surge"
        ? { url: "https://rules.example.com/list.txt" }
        : branch === "singBox"
          ? { url: "https://rules.example.com/list.json", format: "source", intervalSeconds: 86400 }
          : {
              url: "https://rules.example.com/list.yaml",
              format: "yaml",
              intervalSeconds: 86400,
              behavior: "domain",
            };
    for (const patch of [
      { headers: {} },
      { url: "https://user:password@rules.example.com/list.txt" },
      { intervalSeconds: 59 },
      { intervalSeconds: 1.5 },
    ])
      assert.throws(() => ruleSet({ id: "test", [branch]: { ...valid, ...patch } } as never));
  });

// @feature docs/feature/profile/library/conditions.md#来源冲突与复用
test("Mihomo compares behavior and preserves raw URL identity", () => {
  const t = { engine: "mihomo", platform: "linux", version: "1.19.32" } as const;
  const set = (
    id: string,
    behavior: "domain" | "classical",
    url = "https://rules.example.com/list.yaml",
  ) => ruleSet({ id, mihomo: { url, format: "yaml", intervalSeconds: 86400, behavior } });
  assert.equal(check([set("one", "domain"), set("two", "domain")], t).ok, true);
  assert.ok(
    check([set("one", "domain"), set("two", "classical")], t).profiles[0]!.diagnostics.some(
      (d) => d.code === "RULESET_SOURCE_CONFLICT",
    ),
  );
  const surgeTarget = { engine: "surge", platform: "macos", version: "6.10.0" } as const;
  assert.equal(
    check(
      [
        ruleSet({ id: "one", surge: { url: "https://rules.example.com:443/list.txt" } }),
        ruleSet({
          id: "two",
          surge: { url: "https://rules.example.com/list.txt", intervalSeconds: 3600 },
        }),
      ],
      surgeTarget,
    ).ok,
    true,
  );
});
