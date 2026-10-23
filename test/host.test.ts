import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { buildToDirectory, compile } from "../src/index.js";
import { dual, fixture } from "./fixtures.js";

const exec = promisify(execFile);
// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("整批原子发布，权限、秘密隔离、失败保留旧指针与旧文件", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-host-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const compiled = compile(dual(fixture()));
  const first = await buildToDirectory(compiled, root, () => "first-test-token");
  assert.equal(first.exitCode, 0);
  const original = await readFile(join(root, "active.json"), "utf8");
  const pointer = JSON.parse(original);
  assert.equal((await stat(first.generation!)).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, pointer.artifacts.box))).mode & 0o777, 0o600);
  assert.equal(
    (await readFile(join(root, pointer.manifest), "utf8")).includes("first-test-token"),
    false,
  );
  // JSON can encode it, Surge cannot: a later target fails after the earlier one rendered.
  const failed = await buildToDirectory(compiled, root, () => "bad,\nsecret");
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.code, "SURGE_VALUE_UNREPRESENTABLE");
  assert.equal(await readFile(join(root, "active.json"), "utf8"), original);
  assert.equal((await readdir(join(root, "generations"))).length, 1);
  const next = await buildToDirectory(compiled, root, () => "second-test-token");
  assert.equal(next.exitCode, 0);
  assert.notEqual(next.generation, first.generation);
  assert.equal((await readdir(join(root, "generations"))).length, 2);
  assert.match(await readFile(join(root, pointer.artifacts.box), "utf8"), /first-test-token/);
  assert.equal((await readdir(root)).includes(".proxylang-lock"), false);
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("已有锁不抢占且不解析秘密，已有 active 不改变", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-lock-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".proxylang-lock"));
  await writeFile(join(root, "active.json"), "sentinel");
  let resolved = false;
  const result = await buildToDirectory(compile(fixture()), root, () => {
    resolved = true;
    return "dummy";
  });
  assert.equal(result.code, "OUTPUT_LOCKED");
  assert.equal(resolved, false);
  assert.equal(await readFile(join(root, "active.json"), "utf8"), "sentinel");
  assert.ok((await stat(join(root, ".proxylang-lock"))).isDirectory());
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("并发 build 有且仅有一个获得锁", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-race-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const compiled = compile(fixture());
  const results = await Promise.all([
    buildToDirectory(compiled, root, () => "dummy"),
    buildToDirectory(compiled, root, () => "dummy"),
  ]);
  assert.equal(results.filter((r) => r.published).length, 1);
  assert.equal(results.filter((r) => r.code === "OUTPUT_LOCKED").length, 1);
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("输出目录失败不会替换指针，清理自己的锁", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-output-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "active.json"), "old");
  await writeFile(join(root, "generations"), "not-a-directory");
  const result = await buildToDirectory(compile(fixture()), root, () => "dummy");
  assert.equal(result.exitCode, 1);
  assert.equal(await readFile(join(root, "active.json"), "utf8"), "old");
  assert.equal((await readdir(root)).includes(".proxylang-lock"), false);
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("指针提交失败时删除本次未发布 generation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-commit-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "active.json"));
  await writeFile(join(root, "active.json", "sentinel"), "keep");
  const result = await buildToDirectory(compile(fixture()), root, () => "dummy");
  assert.equal(result.published, false);
  assert.deepEqual(await readdir(join(root, "generations")), []);
  assert.equal(await readFile(join(root, "active.json", "sentinel"), "utf8"), "keep");
  assert.equal(
    (await readdir(root)).some((name) => name.startsWith(".active-") || name === ".proxylang-lock"),
    false,
  );
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("拒绝输出根符号链接", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-link-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "actual"));
  await symlink(join(root, "actual"), join(root, "linked"));
  assert.equal(
    (await buildToDirectory(compile(fixture()), join(root, "linked"), () => "dummy")).published,
    false,
  );
  assert.deepEqual(await readdir(join(root, "actual")), []);
});

// @feature docs/feature/artifact-publication/cli.md
test("实际 CLI 加载 TS/import，check 与 explain 不需要秘密，build 发布，case 失败非零", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-cli-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const cli = resolve("dist/cli.js");
  const sdk = pathToFileURL(resolve("dist/index.js")).href;
  await writeFile(
    join(root, "rules.ts"),
    `import {rule,match,reject} from ${JSON.stringify(sdk)}; export default [rule('block',match.domain('blocked.example'),reject())];`,
  );
  const config = fixture();
  const file = join(root, "config.ts");
  await writeFile(
    file,
    `import rules from './rules.ts'; const config=${JSON.stringify(config)}; config.programs.home.routing=rules; export default config;`,
  );
  const env = { ...process.env, TEST_PASSWORD: "" };
  const check = await exec(process.execPath, [cli, "check", file], { env });
  assert.equal(JSON.parse(check.stdout).ok, true);
  const explanation = await exec(
    process.execPath,
    [
      cli,
      "explain",
      file,
      "--target",
      "box",
      "--request",
      '{"network":"tcp","domain":"blocked.example"}',
    ],
    { env },
  );
  assert.equal(JSON.parse(explanation.stdout).rule, "home/block");
  const built = await exec(process.execPath, [cli, "build", file, "--out", join(root, "out")], {
    env: { ...env, TEST_PASSWORD: "cli-test-token" },
  });
  assert.equal(JSON.parse(built.stdout).published, true);
  assert.equal(built.stdout.includes("cli-test-token"), false);
  await writeFile(
    file,
    `export default ${JSON.stringify({ ...config, cases: [{ id: "bad", program: "home", request: { network: "tcp" }, expect: { action: { type: "reject" } } }] })};`,
  );
  await assert.rejects(exec(process.execPath, [cli, "check", file], { env }), (error: unknown) => {
    const result = error as { code: number; stdout: string };
    return result.code === 1 && result.stdout.includes("CASE_FAILED");
  });
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("CLI 加载异常不会打印源码、秘密或原异常消息", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-load-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "broken.ts");
  await writeFile(file, 'throw new Error("secret-marker-in-source");');
  await assert.rejects(
    exec(process.execPath, [resolve("dist/cli.js"), "check", file]),
    (error: unknown) => {
      const result = error as { code: number; stdout: string; stderr: string };
      return (
        result.code === 1 &&
        result.stdout.includes("CONFIG_LOAD_FAILED") &&
        !(result.stdout + result.stderr).includes("secret-marker-in-source")
      );
    },
  );
});

// @feature docs/feature/artifact-publication/cli.md
test("CLI 加载失败提供受控原因，不回显异常及 getter 中的秘密", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-load-reasons-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const marker = "secret-marker-do-not-print";
  const variants = [
    { name: "missing", reason: "MODULE_NOT_FOUND" },
    { name: "import", source: `import './${marker}.ts';`, reason: "MODULE_NOT_FOUND" },
    {
      name: "syntax",
      source: `export default { bad: ; /* ${marker} */ }`,
      reason: "INVALID_SYNTAX",
    },
    {
      name: "permission",
      source: `throw Object.assign(new Error('${marker}'), {code:'EACCES'});`,
      reason: "ACCESS_DENIED",
    },
    { name: "execution", source: `throw new Error('${marker}');`, reason: "EXECUTION_FAILED" },
    {
      name: "getter",
      source: `throw {get code(){throw Error('${marker}')}, get name(){throw Error('${marker}')}};`,
      reason: "EXECUTION_FAILED",
    },
  ];
  for (const variant of variants) {
    const file = join(root, `${variant.name}.ts`);
    if (variant.source) await writeFile(file, variant.source);
    await assert.rejects(
      exec(process.execPath, [resolve("dist/cli.js"), "check", file]),
      (error: unknown) => {
        const result = error as { code: number; stdout: string; stderr: string };
        assert.equal(result.code, 1);
        const output = JSON.parse(result.stdout);
        assert.equal(output.code, "CONFIG_LOAD_FAILED");
        assert.equal(output.reason, variant.reason);
        assert.ok(output.hint.length > 0);
        assert.ok(!(result.stdout + result.stderr).includes(marker), variant.name);
        return true;
      },
    );
  }
});
