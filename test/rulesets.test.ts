import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import {
  buildToDirectory,
  compile,
  direct,
  explain,
  match as m,
  mihomo,
  policy,
  reject,
  render,
  rule,
  ruleSet,
  singbox,
  slot,
  surge,
  use,
  StaticRuleSetUnknownError,
  type Config,
  type Match,
  type Engine,
} from "../src/index.js";
import { evaluate } from "../src/rules.js";

const url = "https://example.com/rules";
const box = () => singbox.ruleSet({ id: "remote", url, format: "source", intervalSeconds: 600 });
function config(when: Match, engine: Engine = "sing-box"): Config {
  return {
    programs: {
      home: {
        engine,
        nodes: [],
        groups: [],
        routing: [rule("sample", when, direct())],
        fallback: reject(),
      },
    },
    targets: [
      {
        id: "test",
        program: "home",
        engine,
        version:
          engine === "surge"
            ? "6.10.0"
            : engine === "mihomo"
              ? "1.19.32"
              : engine === "stash"
                ? "4.2.1"
                : "1.12.0",
        platform: "macos",
      },
    ],
  };
}
function content(c: Config) {
  const result = compile(c);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return render(result, () => undefined)[0]!.content;
}
// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
test("命名条件集合组合原生资源，保留逻辑结构和来源，按使用处绑定出口", () => {
  const set = ruleSet({ id: "media", when: m.any(box(), m.domainSuffix("example.org")) });
  const inner = ruleSet({ id: "nested", when: m.all(m.network("tcp"), m.not(set)) });
  const p = policy({ id: "template", exits: ["out"], rules: [rule("match", inner, slot("out"))] });
  const c = config(set);
  const compiled = compile({
    ...c,
    programs: {
      home: {
        ...c.programs.home!,
        routing: [
          use(p, { id: "first", bindings: { out: direct() } }),
          use(p, { id: "second", bindings: { out: reject() } }),
        ],
      },
    },
  });
  assert.equal(compiled.ok, true);
  const plan = compiled.plans[0]!;
  assert.equal(plan.nativeRuleSets.length, 1);
  assert.equal(plan.rules.length, 2);
  assert.deepEqual(
    plan.rules.map((r) => r.then),
    [direct(), reject()],
  );
  assert.ok(plan.sourceMap[0]!.origin.includes("rule-set:media"));
  const native = JSON.parse(render(compiled, () => undefined)[0]!.content);
  assert.equal(native.route.rule_set.length, 1);
  assert.equal(native.route.rule_set[0].download_detour, "pl-direct");
  assert.equal(native.route.rules[0].rules[1].invert, true);
});
// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
test("Surge顶层两种格式保留更新选项；嵌套默认更新，显式间隔拒绝", () => {
  for (const format of ["rule-set", "domain-set"] as const) {
    const r = surge.ruleSet({ id: "remote", url, format, intervalSeconds: 600 });
    assert.ok(
      content(config(ruleSet({ id: "wrap", when: r }), "surge")).includes(
        `${format.toUpperCase()},${url},DIRECT,update-interval=600`,
      ),
    );
    assert.ok(
      compile(config(m.all(m.network("tcp"), r), "surge")).diagnostics.some(
        (d) => d.code === "RULESET_COMPOSITION_UNSUPPORTED",
      ),
    );
    const plain = surge.ruleSet({ id: "remote", url, format });
    assert.ok(
      content(config(m.any(m.not(plain), m.domain("example.org")), "surge")).includes(
        `NOT,((${format.toUpperCase()},${url}))`,
      ),
    );
  }
});
// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
test("Mihomo原生provider声明去重，YAML与text格式保持，规则组合不扁平化", () => {
  for (const format of ["yaml", "text"] as const) {
    const r = mihomo.ruleProvider({
      id: "remote",
      url,
      format,
      behavior: "classical",
      intervalSeconds: 600,
    });
    const doc = parse(content(config(m.all(r, m.any(r, m.domain("example.org"))), "mihomo")));
    assert.deepEqual(Object.keys(doc["rule-providers"]), ["remote"]);
    assert.equal(doc["rule-providers"].remote.format, format);
    assert.equal(doc["rule-providers"].remote.proxy, "DIRECT");
    assert.equal(
      doc["rule-providers"].remote.path,
      `rule-providers/pl-remote.${format === "yaml" ? "yaml" : "txt"}`,
    );
    assert.equal(
      doc.rules[0],
      "AND,((RULE-SET,remote),(OR,((RULE-SET,remote),(DOMAIN,example.org)))),DIRECT",
    );
  }
});
// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
test("完整源树检查跨引擎、同ID异定义和Surge同URL格式冲突", () => {
  const bad = m.all(
    m.network("udp"),
    m.network("tcp"),
    ruleSet({ id: "hidden", when: surge.ruleSet({ id: "foreign", url }) }),
  );
  assert.ok(compile(config(bad)).diagnostics.some((d) => d.code === "NATIVE_TARGET_MISMATCH"));
  assert.ok(
    compile(config(m.any(box(), { ...box(), url: url + "/different" }))).diagnostics.some(
      (d) => d.code === "RULESET_ID_CONFLICT",
    ),
  );
  assert.ok(
    compile(
      config(m.any(box(), ruleSet({ id: "remote", when: m.domain("example.org") }))),
    ).diagnostics.some((d) => d.code === "RULESET_ID_CONFLICT"),
  );
  assert.ok(
    compile(
      config(
        m.any(
          surge.ruleSet({ id: "one", url }),
          surge.ruleSet({ id: "two", url, format: "domain-set" }),
        ),
        "surge",
      ),
    ).diagnostics.some((d) => d.code === "RULESET_URL_CONFLICT"),
  );
  assert.equal(
    compile(
      config(
        m.any(box(), {
          intervalSeconds: 600,
          format: "source",
          engine: "sing-box",
          url,
          id: "remote",
          type: "nativeRuleSet",
        }),
      ),
    ).ok,
    true,
  );
  const a = config(box());
  const b = config(surge.ruleSet({ id: "remote", url }), "surge");
  assert.equal(
    compile({
      programs: { a: a.programs.home, b: b.programs.home },
      targets: [
        { ...a.targets[0], id: "a", program: "a" },
        { ...b.targets[0], id: "b", program: "b" },
      ],
    }).ok,
    true,
  );
  assert.equal(compile(config(box(), "stash")).ok, false);
});
// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
test("远程条件三值逻辑、first-match和案例不确定，不将unknown当false", () => {
  const req = { network: "tcp" as const, domain: "example.org" };
  assert.equal(evaluate(box(), req).matched, null);
  assert.equal(evaluate(m.not(box()), req).matched, null);
  assert.equal(evaluate(m.all(box(), m.network("udp")), req).matched, false);
  assert.equal(evaluate(m.any(box(), m.network("tcp")), req).matched, true);
  assert.throws(() => explain(compile(config(box())), "test", req), StaticRuleSetUnknownError);
  assert.equal(
    explain(compile(config(m.all(box(), m.network("udp")))), "test", req).rule,
    "$fallback",
  );
  const c = config(box());
  const compiled = compile({
    ...c,
    cases: [
      { id: "unknown", program: "home", request: req, expect: { action: reject() } },
      { id: "known", program: "other", request: req, expect: { action: direct() } },
    ],
    programs: { ...c.programs, other: { ...c.programs.home!, routing: [], fallback: direct() } },
  });
  assert.equal(compiled.ok, false);
  assert.deepEqual(compiled.cases[0], { id: "unknown", passed: false, code: "CASE_INDETERMINATE" });
  assert.equal(compiled.cases[1]!.passed, true);
  const prior = compile({
    ...c,
    programs: {
      home: {
        ...c.programs.home!,
        routing: [rule("early", m.network("tcp"), direct()), ...c.programs.home!.routing],
      },
    },
  });
  assert.equal(explain(prior, "test", req).rule, "home/early");
});
// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
test("严格URL/原生字段校验与warningsAsErrors；不会依赖远程内容证明UDP安全", () => {
  for (const value of [
    "https://user:password@example.com/a",
    "https://example.com/a,b",
    "https://example.com/(x)",
    "https://example.com/a#b",
    "file:///tmp/a",
    "https://example.com/a\nb",
  ]) {
    assert.equal(compile(config({ ...box(), url: value })).ok, false);
  }
  assert.equal(compile(config({ ...box(), unexpected: true } as unknown as Match)).ok, false);
  assert.equal(compile({ ...config(box()), warningsAsErrors: true }).ok, false);
  const c = config(box());
  const node = {
    type: "http",
    id: "http",
    server: "192.0.2.1",
    port: 80,
    password: { type: "env", name: "PASS" },
  };
  const risky = {
    ...c,
    programs: {
      home: {
        ...c.programs.home!,
        nodes: [node],
        routing: [rule("remote", box(), { type: "route", to: "http" })],
      },
    },
  };
  assert.ok(compile(risky).diagnostics.some((d) => d.code === "NETWORK_UNSUPPORTED"));
});
// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
test("真实构建不下载外部规则；非法组合失败保留active", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pl-remote-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const c = config({ ...box(), url: "http://127.0.0.1:1/unreachable" });
  assert.equal((await buildToDirectory(compile(c), root)).exitCode, 0);
  const active = await readFile(join(root, "active.json"), "utf8");
  assert.equal(
    (
      await buildToDirectory(
        compile(config(m.not(surge.ruleSet({ id: "remote", url, intervalSeconds: 600 })), "surge")),
        root,
      )
    ).exitCode,
    1,
  );
  assert.equal(await readFile(join(root, "active.json"), "utf8"), active);
});

test("CLI exercises the three-platform example and refuses an unknown first match", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "ruleset-cli-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const cli = resolve("dist/cli.js");
  await writeFile(
    join(root, "proxylang.config.ts"),
    `import config from ${JSON.stringify(resolve("examples/rule-sets/proxylang.config.ts"))}; export default {...config,outDir:"build"};`,
  );
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  const checked = run("check");
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const result = JSON.parse(checked.stdout);
  assert.equal(result.targets.length, 3);
  assert.equal(result.cases[0].passed, true);
  const unknown = run(
    "explain",
    "--target",
    "box",
    "--request",
    JSON.stringify({ network: "tcp", domain: "unknown.example" }),
  );
  assert.equal(unknown.status, 1);
  assert.deepEqual(JSON.parse(unknown.stdout), { ok: false, code: "STATIC_RULESET_UNKNOWN" });
  const known = run(
    "explain",
    "--target",
    "box",
    "--request",
    JSON.stringify({ network: "tcp", domain: "local.example" }),
  );
  assert.equal(known.status, 0, known.stdout);
  const dir = join(root, "build");
  try {
    const built = run("build");
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const active = JSON.parse(await readFile(join(dir, "active.json"), "utf8"));
    assert.equal(Object.keys(active.artifacts).length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
