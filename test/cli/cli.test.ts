import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, readdir, mkdir, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const cli = resolve("dist/cli.js");
const run = (cwd: string, args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
const json = (cwd: string, args: string[]) => {
  const r = run(cwd, [...args, "--json"]);
  return {
    status: r.status,
    stderr: r.stderr,
    result: JSON.parse(r.stdout) as {
      code?: string;
      ok?: boolean;
      published?: boolean;
      origin?: { file: string };
      paths?: string[];
      hint?: string;
      targets?: {
        engine: string;
        platform: string;
        version: string;
        modes: string[];
        artifact: string;
      }[];
    },
  };
};
const config = `import {defineBuild,defineProfile,proxy,defineSecrets,group,defineProxyGroup,ruleSet,defineRoutes} from ${JSON.stringify(resolve("dist/index.js"))};
console.log('TEST_CONFIG_LOG');console.info('TEST_CONFIG_INFO');
const secrets=defineSecrets({TEST_PASSWORD:{value:'TEST_DO_NOT_ECHO',validation:'test-valid'}});
const edge=proxy.trojan({id:'edge',server:'192.0.2.10',port:443,password:secrets.TEST_PASSWORD});
const choice=defineProxyGroup({id:'choice',name:'Choice',algorithm:group.auto(),members:[edge]});
export default defineBuild({outDir:'generated',secrets,profiles:{one:defineProfile({target:{engine:'surge',platform:'macos',version:'6.10.0'},proxies:[edge],groups:[choice],routes:defineRoutes({when:ruleSet({id:"external",surge:{url:"https://rules.example.com/list.txt"}}),to:edge}),fallback:choice})}});`;
// @feature docs/feature/build/cli.md#输出
for (const scope of ["module", "commonjs"])
  test(`CLI ${scope} uses one SDK identity scope and isolates stdout during loading/build`, async () => {
    const root = await mkdtemp(join(tmpdir(), "proxylang-cli-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify({ type: scope }));
      assert.equal(json(root, ["check"]).result.code, "CONFIG_NOT_FOUND");
      await writeFile(join(root, "proxylang.config.ts"), config);
      const checked = json(root, ["check"]);
      assert.equal(checked.result.ok, true, JSON.stringify(checked));
      assert.match(checked.stderr, /TEST_CONFIG_LOG/);
      assert.match(checked.stderr, /TEST_CONFIG_INFO/);
      assert.doesNotMatch(JSON.stringify(checked.result), /TEST_DO_NOT_ECHO/);
      assert.equal((await readdir(root)).includes("generated"), false);
      const human = run(root, ["check"]);
      assert.equal(human.status, 0);
      assert.match(human.stdout, /✓ one.*surge macos 6.10.0/);
      assert.match(human.stdout, /choice→surge-smart/);
      assert.match(human.stdout, /ruleSets: external→surge/);
      assert.doesNotMatch(human.stdout, /TEST_CONFIG_LOG|TEST_DO_NOT_ECHO/);
      assert.equal(json(root, ["build", "--validation"]).result.published, true);
      await writeFile(
        join(root, "proxylang.config.ts"),
        config.replace("proxies:[edge]", "proxies:[]"),
      );
      const failed = json(root, ["build", "--validation"]);
      assert.equal(failed.status, 1);
      assert.equal(failed.result.code, "CHECK_FAILED");
      await writeFile(
        join(root, "proxylang.config.ts"),
        config.replace("password:secrets.TEST_PASSWORD", "password:'TEST_DO_NOT_ECHO' as never"),
      );
      const structural = json(root, ["check"]);
      assert.equal(structural.result.code, "CONFIG_LOAD_FAILED");
      assert.equal(structural.result.hint, "INVALID_RESOURCE");
      assert.ok(structural.result.origin?.file.endsWith("proxylang.config.ts"));
      assert.doesNotMatch(JSON.stringify(structural.result), /TEST_DO_NOT_ECHO/);
      await writeFile(join(root, "proxylang.config.ts"), "throw new Error('TEST_DO_NOT_ECHO');");
      assert.equal(json(root, ["check"]).result.code, "CONFIG_LOAD_FAILED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
// @feature docs/feature/build/cli.md#命令
test("help and targets do not load config; flags reject repeats and unsupported forms before loading", async () => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-cli-"));
  try {
    await writeFile(join(root, "proxylang.config.ts"), "throw new Error('TEST_NOT_LOADED');");
    for (const args of [["--help"], ["check", "--help"], ["targets"], ["targets", "--help"]])
      assert.equal(run(root, args).status, 0);
    const targets = json(root, ["targets"]).result.targets!;
    assert.equal(targets.length, 9);
    assert.ok(
      targets.some(
        (t) =>
          t.engine === "stash" &&
          t.platform === "macos" &&
          t.modes.join() === "fragment" &&
          t.artifact === ".yaml",
      ),
    );
    for (const args of [
      ["check", "--json", "--json"],
      ["build", "--validation", "--validation"],
      ["check", "--validation"],
      ["explain", "--target", "one", "--request", "{}"],
      ["explain", "--profile", "one"],
      ["explain", "--profile", "one", "--request", "{}", "--request-file", "input.json"],
      ["build", "--config", "unsafe"],
    ])
      assert.equal(json(root, args).result.code, "INVALID_ARGUMENTS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// @feature docs/feature/build/format/project-config.md
test("relative output stays anchored to the CLI invocation directory when trusted configuration changes cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-cli-cwd-"));
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      join(root, "proxylang.config.ts"),
      `process.chdir(${JSON.stringify(join(root, "nested"))});\n` + config,
    );
    const result = json(root, ["build", "--validation"]);
    assert.equal(result.status, 0);
    await access(join(root, "generated/out/one.conf"));
    await assert.rejects(access(join(root, "nested/generated")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
