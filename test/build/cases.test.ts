import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defineProfile,
  defineRoutes,
  defineBuild,
  defineSecrets,
  proxy,
  match,
  outbound,
  checkBuild,
  runBuild,
  explainProfile,
  ruleSet,
  type RouteCase,
} from "proxylang";
const target = { engine: "surge", platform: "macos", version: "6.11.0" } as const;
const profile = (cases: readonly RouteCase[]) =>
  defineProfile({
    target,
    proxies: [],
    groups: [],
    routes: defineRoutes({ when: match.domain("example.com"), to: outbound.reject }),
    fallback: outbound.direct,
    cases,
  });
// @feature docs/feature/routing-cases/library.md#check-结果中的案例
test("check executes all cases in valid profiles, reports logical IDs and route origin", () => {
  const cases = [
    { name: "matched", request: { domain: "example.com" }, expect: outbound.reject },
    { name: "fallback", request: { domain: "other.example" }, expect: outbound.direct },
  ];
  const result = checkBuild(
    defineBuild({
      profiles: { one: profile(cases), two: profile([{ ...cases[0]!, expect: outbound.direct }]) },
    }),
  );
  assert.equal(result.code, "CASE_FAILED");
  assert.deepEqual(
    result.cases.map((c) => [c.profile, c.name, c.ok, c.outcome, c.expected, c.actual]),
    [
      ["one", "matched", true, "matched", "REJECT", "REJECT"],
      ["one", "fallback", true, "fallback", "DIRECT", "DIRECT"],
      ["two", "matched", false, "matched", "DIRECT", "REJECT"],
    ],
  );
  assert.equal(result.cases[0]?.route?.index, 0);
  assert.ok(result.cases[0]?.route?.origin?.file.endsWith("cases.test.ts"));
});
// @feature docs/feature/routing-cases/library.md#check-结果中的案例
test("profile errors skip its cases, preserve valid-profile evaluation and take precedence over failed cases", () => {
  const unknown = ruleSet({
    id: "external",
    singBox: {
      url: "https://rules.example.com/one.json",
      format: "source",
      intervalSeconds: 86400,
    },
  });
  const bad = defineProfile({
    ...profile([{ name: "skipped", request: {}, expect: outbound.direct }]),
    routes: defineRoutes({ when: unknown, to: outbound.direct }),
  });
  const result = checkBuild(
    defineBuild({
      profiles: {
        bad,
        good: profile([
          { name: "failed", request: { domain: "example.com" }, expect: outbound.direct },
        ]),
      },
    }),
  );
  assert.equal(result.code, "CHECK_FAILED");
  assert.deepEqual(
    result.cases.map((c) => [c.name, c.outcome, c.ok]),
    [
      ["skipped", "skipped", false],
      ["failed", "matched", false],
    ],
  );
  const explain = explainProfile(bad, { domain: "INVALID" });
  assert.ok(!explain.ok, "normalization precedes request validation");
});
// @feature docs/feature/routing-cases/README.md#假设
test("case validation collects duplicate names, invalid requests and foreign assumptions", () => {
  const unused = ruleSet({ id: "unused", surge: { url: "https://rules.example.com/unused" } });
  const result = checkBuild(
    defineBuild({
      profiles: {
        one: profile([
          { name: "same", request: { port: 0 }, expect: outbound.direct },
          { name: "same", request: {}, assume: { miss: [unused] }, expect: outbound.direct },
        ]),
      },
    }),
  );
  assert.equal(result.code, "CHECK_FAILED");
  assert.deepEqual(
    new Set(result.profiles[0]?.diagnostics.map((d) => d.code)),
    new Set(["INVALID_REQUEST", "CASE_NAME_DUPLICATE", "ASSUMPTION_UNKNOWN_RULESET"]),
  );
  assert.ok(result.cases.every((c) => c.outcome === "skipped"));
  const used = ruleSet({ id: "used", surge: { url: "https://rules.example.com/used" } });
  const uncertain = defineProfile({
    ...profile([]),
    routes: defineRoutes({ when: used, to: outbound.reject }),
    cases: [{ name: "unknown", request: {}, expect: outbound.direct }],
  });
  const checked = checkBuild(defineBuild({ profiles: { one: uncertain } }));
  assert.equal(checked.code, "CASE_FAILED");
  assert.deepEqual(checked.cases[0]?.needs, { kind: "ruleSet", id: "used" });
});
// @feature docs/feature/routing-cases/library.md#explainprofile
test("standalone explain accepts secret handles without a build collection and uses exit IDs", () => {
  const secrets = defineSecrets({
    TEST_PASSWORD: { env: "TEST_MISSING_CASE_SECRET", validation: "test-only" },
  });
  const node = proxy.trojan({
    id: "edge",
    name: "Display Edge",
    server: "192.0.2.10",
    port: 443,
    password: secrets.TEST_PASSWORD,
  });
  const p = defineProfile({
    target,
    proxies: [node],
    groups: [],
    routes: defineRoutes({ when: match.network("tcp"), to: node }),
    fallback: outbound.direct,
  });
  const result = explainProfile(p, {});
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.explanation.exit, "edge");
});
// @feature docs/feature/routing-cases/library.md#check-结果中的案例
test("failed cases prevent secret reads, new directories and changing the active generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-cases-"));
  try {
    const secrets = defineSecrets({
      TEST_PASSWORD: { env: "TEST_MISSING_CASE_SECRET", validation: "test-only" },
    });
    const node = proxy.trojan({
      id: "edge",
      server: "192.0.2.10",
      port: 443,
      password: secrets.TEST_PASSWORD,
    });
    const invalid = defineProfile({
      ...profile([{ name: "fail", request: {}, expect: outbound.reject }]),
      proxies: [node],
    });
    const first = await runBuild(
      defineBuild({ outDir: join(root, "new"), profiles: { one: invalid }, secrets }),
    );
    assert.equal(first.code, "CASE_FAILED");
    assert.deepEqual(await readdir(root), []);
    const active = defineBuild({ outDir: join(root, "existing"), profiles: { one: profile([]) } });
    assert.equal((await runBuild(active)).published, true);
    const before = await readlink(join(root, "existing/out"));
    const files = await readdir(join(root, "existing"));
    const failed = await runBuild(
      defineBuild({ outDir: join(root, "existing"), profiles: { one: invalid }, secrets }),
    );
    assert.equal(failed.code, "CASE_FAILED");
    assert.equal(await readlink(join(root, "existing/out")), before);
    assert.deepEqual(await readdir(join(root, "existing")), files);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// @feature docs/feature/routing-cases/library.md#explainprofile
test("explain rejects unregistered profiles through the diagnostic result API", () => {
  const p = profile([]);
  const result = explainProfile({ ...p } as never, {});
  assert.ok(!result.ok);
  assert.equal(result.diagnostics[0]?.code, "INVALID_RESOURCE");
});
// @feature docs/feature/targets/README.md#诊断
test("case assumption errors are collected independently of target failures without evaluating the profile", () => {
  const first = ruleSet({
    id: "first",
    singBox: {
      url: "https://rules.example.com/list.json",
      format: "source",
      intervalSeconds: 86400,
    },
  });
  const second = ruleSet({
    id: "second",
    singBox: {
      url: "https://rules.example.com/list.json",
      format: "source",
      intervalSeconds: 86400,
    },
  });
  const unused = ruleSet({ id: "unused", surge: { url: "https://rules.example.com/unused" } });
  const p = defineProfile({
    target: { engine: "sing-box", platform: "linux", version: "1.14.4" },
    singBox: { mode: "fragment" },
    proxies: [],
    groups: [],
    routes: [defineRoutes({ when: [first, second], to: outbound.rejectDrop })],
    fallback: outbound.direct,
    cases: [
      {
        name: "conflicting",
        request: {},
        assume: { hit: [first], miss: [second] },
        expect: outbound.direct,
      },
      { name: "foreign", request: {}, assume: { hit: [unused] }, expect: outbound.direct },
      {
        name: "invalid structure",
        request: {},
        assume: { hit: "invalid" } as never,
        expect: outbound.direct,
      },
    ],
  });
  const checked = checkBuild(defineBuild({ profiles: { one: p } }));
  assert.equal(checked.code, "CHECK_FAILED");
  for (const code of ["EXIT_UNSUPPORTED", "INVALID_ASSUMPTIONS", "ASSUMPTION_UNKNOWN_RULESET"])
    assert.ok(
      checked.profiles[0]?.diagnostics.some((d) => d.code === code),
      JSON.stringify(checked),
    );
  assert.ok(checked.cases.every((c) => c.outcome === "skipped"));
  assert.ok(checked.profiles[0]?.diagnostics.some((d) => d.path === "cases[2].assume.hit"));
});
