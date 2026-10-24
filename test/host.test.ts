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
  const config = { ...fixture(), outDir: "out" };
  const file = join(root, "proxylang.config.ts");
  await writeFile(
    file,
    `import rules from './rules.ts'; const config=${JSON.stringify(config)}; config.programs.home.routing=rules; export default config;`,
  );
  const env = { ...process.env, TEST_PASSWORD: "" };
  const check = await exec(process.execPath, [cli, "check"], { env, cwd: root });
  assert.equal(JSON.parse(check.stdout).ok, true);
  const explanation = await exec(
    process.execPath,
    [
      cli,
      "explain",
      "--target",
      "box",
      "--request",
      '{"network":"tcp","domain":"blocked.example"}',
    ],
    { env, cwd: root },
  );
  assert.equal(JSON.parse(explanation.stdout).rule, "home/block");
  const built = await exec(process.execPath, [cli, "build"], {
    cwd: root,
    env: { ...env, TEST_PASSWORD: "cli-test-token" },
  });
  assert.equal(JSON.parse(built.stdout).published, true);
  assert.equal(built.stdout.includes("cli-test-token"), false);
  await writeFile(
    file,
    `export default ${JSON.stringify({ ...config, cases: [{ id: "bad", program: "home", request: { network: "tcp" }, expect: { action: { type: "reject" } } }] })};`,
  );
  await assert.rejects(
    exec(process.execPath, [cli, "check"], { env, cwd: root }),
    (error: unknown) => {
      const result = error as { code: number; stdout: string };
      return result.code === 1 && result.stdout.includes("CASE_FAILED");
    },
  );
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("CLI 加载异常不会打印源码、秘密或原异常消息", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-load-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "proxylang.config.ts");
  await writeFile(file, 'throw new Error("secret-marker-in-source");');
  await assert.rejects(
    exec(process.execPath, [resolve("dist/cli.js"), "check"], { cwd: root }),
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
    const file = join(root, "proxylang.config.ts");
    if (variant.source) await writeFile(file, variant.source);
    await assert.rejects(
      exec(process.execPath, [resolve("dist/cli.js"), "check"], { cwd: root }),
      (error: unknown) => {
        const result = error as { code: number; stdout: string; stderr: string };
        assert.equal(result.code, 1);
        const output = JSON.parse(result.stdout);
        assert.equal(
          output.code,
          variant.name === "missing" ? "CONFIG_NOT_FOUND" : "CONFIG_LOAD_FAILED",
        );
        if (variant.name !== "missing") {
          assert.equal(output.reason, variant.reason);
          assert.ok(output.hint.length > 0);
        }
        assert.ok(!(result.stdout + result.stderr).includes(marker), variant.name);
        return true;
      },
    );
  }
});

// @feature docs/feature/artifact-publication/cli.md
test("子命令帮助与非法参数不执行配置", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-help-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const cli = resolve("dist/cli.js");
  const file = join(root, "proxylang.config.ts");
  const marker = join(root, "executed");
  await writeFile(
    file,
    `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'yes'); throw Error('do-not-print');`,
  );
  for (const command of ["check", "explain", "build", "targets"]) {
    for (const flag of ["--help", "-h"]) {
      const output = JSON.parse(
        (await exec(process.execPath, [cli, command, flag], { cwd: root })).stdout,
      );
      assert.ok(output.usage.every((line: string) => line.startsWith(`proxylang ${command}`)));
    }
  }
  for (const args of [
    ["--help", "extra"],
    ["build", "--help", "extra"],
    ["build", file, "--out", ""],
    ["build", file, "--out", "   "],
    ["build", file, "--out"],
    ["check", file, "--typo", "yes"],
    ["explain", file, "--target", "box"],
    ["explain", file, "--target", "box", "--request", "{}", "--request-file", "request.json"],
    ["explain", file, "--target", "box", "--target", "box", "--request", "{}"],
  ])
    await assert.rejects(
      exec(process.execPath, [cli, ...args], { cwd: root }),
      (error: unknown) => {
        const result = error as { code: number; stdout: string; stderr: string };
        assert.equal(result.code, 1);
        assert.equal(JSON.parse(result.stdout).code, "INVALID_ARGUMENTS");
        assert.ok(!(result.stdout + result.stderr).includes("do-not-print"));
        return true;
      },
    );
  assert.ok(!(await readdir(root)).includes("executed"));
});

// @feature docs/feature/artifact-publication/cli.md
test("请求文件与中文空格路径跨工作目录运行，连续 build 保留上一批", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-paths-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "配置 空间 #1");
  await mkdir(folder);
  await writeFile(
    join(folder, "local.ts"),
    `export default ${JSON.stringify({ ...fixture(), outDir: "../产物 空间" })};`,
  );
  await writeFile(
    join(folder, "proxylang.config.ts"),
    "import config from './local.ts'; export default config;",
  );
  await writeFile(join(root, "请求 信息.json"), '\ufeff{"network":"tcp","domain":"example.com"}');
  const cli = resolve("dist/cli.js");
  const requestArgs = [cli, "explain", "--target", "box"];
  const env = { ...process.env, TEST_PASSWORD: "" };
  const fromFile = JSON.parse(
    (
      await exec(process.execPath, [...requestArgs, "--request-file", "../请求 信息.json"], {
        cwd: folder,
        env,
      })
    ).stdout,
  );
  const inline = JSON.parse(
    (
      await exec(
        process.execPath,
        [...requestArgs, "--request", '{"network":"tcp","domain":"example.com"}'],
        { cwd: folder, env },
      )
    ).stdout,
  );
  assert.deepEqual(fromFile, inline);
  const out = join(root, "产物 空间");
  const build = () =>
    exec(process.execPath, [cli, "build"], {
      cwd: folder,
      env: { ...env, TEST_PASSWORD: "path-test-secret" },
    });
  const first = JSON.parse((await build()).stdout);
  const old = JSON.parse(await readFile(join(out, "active.json"), "utf8"));
  assert.equal(first.published, true);
  const second = JSON.parse((await build()).stdout);
  assert.equal(second.published, true);
  assert.notEqual(second.generation, first.generation);
  assert.ok((await readFile(join(out, old.artifacts.box), "utf8")).length > 0);
  for (const [name, content, expected] of [
    ["missing.json", undefined, "REQUEST_FILE_READ_FAILED"],
    ["bad.json", "secret-invalid-json", "INVALID_REQUEST"],
    ["schema.json", '{"network":"bad-secret"}', "INVALID_REQUEST"],
    ["large.json", "x".repeat(1024 * 1024 + 1), "REQUEST_FILE_TOO_LARGE"],
    [".", undefined, "REQUEST_FILE_READ_FAILED"],
  ] as const) {
    if (content !== undefined) await writeFile(join(folder, name), content);
    await assert.rejects(
      exec(process.execPath, [...requestArgs, "--request-file", name], { cwd: folder, env }),
      (error: unknown) => {
        const result = error as { code: number; stdout: string; stderr: string };
        assert.equal(result.code, 1);
        assert.equal(JSON.parse(result.stdout).code, expected);
        assert.ok(!(result.stdout + result.stderr).includes("secret-invalid-json"));
        assert.ok(!(result.stdout + result.stderr).includes("bad-secret"));
        return true;
      },
    );
  }
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("构建错误附带可执行提示，空路径不读取秘密，目录错误不泄露路径", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-diagnostics-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const compilation = compile(fixture());
  let reads = 0;
  for (const output of ["", "   "]) {
    const result = await buildToDirectory(compilation, output, () => {
      reads++;
      return "secret";
    });
    assert.equal(result.code, "INVALID_OUTPUT_DIRECTORY");
    assert.ok(result.hint);
  }
  assert.equal(reads, 0);
  const blocked = join(root, "private-path-marker");
  await writeFile(blocked, "file");
  const failed = await buildToDirectory(compilation, blocked, () => "secret");
  assert.equal(failed.code, "OUTPUT_FAILED");
  assert.equal(failed.reason, "INVALID_DIRECTORY");
  assert.ok(failed.hint);
  assert.ok(!JSON.stringify(failed).includes("private-path-marker"));
  const missing = await buildToDirectory(compilation, join(root, "out"), () => undefined);
  assert.equal(missing.code, "SECRET_MISSING");
  assert.ok(missing.hint);
  assert.equal(missing.published, false);
  assert.ok(!(await readdir(join(root, "out"))).includes(".proxylang-lock"));
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("project build CLI validates before import and preserves batch results through TS/ESM/CJS", async (t) => {
  const command = "build";
  const root = await mkdtemp(join(tmpdir(), "profile-build-cli-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const cli = resolve("dist/cli.js");
  const call = async (args: string[]) => {
    try {
      const result = await exec(process.execPath, [cli, command, ...args], { cwd: root });
      return { status: 0, result: JSON.parse(result.stdout) };
    } catch (error) {
      const failure = error as { code: number; stdout: string };
      return { status: failure.code, result: JSON.parse(failure.stdout) };
    }
  };
  const config = join(root, "proxylang.config.ts");
  const marker = join(root, "loaded");
  await writeFile(
    config,
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'loaded'); throw Error('private-value');`,
  );
  for (const args of [
    [config, "--out", "--validation"],
    [config, "--out"],
    [config, "extra", "--out", root],
    [config, "--out", root, "--out", root],
    [config, "--validation", "--validation", "--out", root],
    [config, "--", "--out", root],
    [config, "--out", root, "--"],
    [config, "--out", root, "--unknown"],
    [config, "--help"],
  ]) {
    const response = await call(args);
    assert.equal(response.status, 1);
    assert.equal(response.result.code, "INVALID_ARGUMENTS");
  }
  assert.ok(!(await readdir(root)).includes("loaded"));
  assert.equal((await call(["--help"])).status, 0);
  const load = await call(["--validation"]);
  assert.equal(load.result.code, "CONFIG_LOAD_FAILED");
  assert.ok(!JSON.stringify(load).includes("private-value"));
  const source = `({profiles: {box: {target: {engine:'surge', platform:'macos', version:'6.10.0'}, proxies:[], groups:[], routes:[], fallback:{builtin:'DIRECT'}}}, preflight:()=>['WARN'], resolveSecret:()=> 'fixture'})`;
  for (const extension of ["ts", "mjs", "cjs"]) {
    const path = join(root, `valid.${extension}`);
    await writeFile(
      path,
      `${extension === "cjs" ? "module.exports = " : "export default "}${source}`,
    );
    const output = join(root, extension);
    await writeFile(
      config,
      `import value from ${JSON.stringify(path)}; export default {...value,outDir:${JSON.stringify(output)}};`,
    );
    const response = await call(["--", "--validation"]);
    assert.equal(response.status, 0, JSON.stringify({ extension, ...response }));
    assert.equal(response.result.published, true);
    assert.equal(response.result.exitCode, 0);
    assert.equal(response.result.profileCount, 1);
    assert.deepEqual(response.result.warnings, { WARN: 1 });
    assert.equal(response.result.active, join(output, "out"));
    assert.match(await readFile(join(output, "out", "box.conf"), "utf8"), /FINAL,DIRECT/);
  }
  // Fault only the filesystem boundary in the real CLI process.
  for (const kind of ["cleanup", "recovery"]) {
    const fault = join(root, `${kind}-fault.cjs`);
    await writeFile(
      fault,
      `const fs=require('node:fs/promises'); const {syncBuiltinESMExports}=require('node:module');
      const rename=fs.rename; let calls=0;
      ${kind === "cleanup" ? "fs.rm=async()=>{throw Error('private-fault')};" : "fs.rename=async(...args)=>{if(++calls>1)throw Error('private-fault');return rename(...args)};"}
      syncBuiltinESMExports();`,
    );
    const output = join(root, kind);
    if (kind === "recovery") {
      await mkdir(join(output, "out"), { recursive: true });
      await writeFile(join(output, "out", "box.conf"), "legacy");
    }
    await writeFile(
      config,
      `import value from "./valid.mjs"; export default {...value,outDir:${JSON.stringify(output)}};`,
    );
    let response;
    try {
      await exec(process.execPath, ["--require", fault, cli, command], { cwd: root });
      assert.fail("fault must affect the CLI exit status");
    } catch (error) {
      const failure = error as { code: number; stdout: string };
      response = { status: failure.code, result: JSON.parse(failure.stdout) };
    }
    assert.equal(response.status, kind === "cleanup" ? 2 : 1);
    assert.equal(response.result.exitCode, response.status);
    assert.equal(response.result.published, kind === "cleanup");
    assert.equal(
      response.result.code,
      kind === "cleanup" ? "PUBLISHED_CLEANUP_FAILED" : "PUBLISH_RECOVERY_REQUIRED",
    );
    if (kind === "cleanup") {
      assert.equal(response.result.active, join(output, "out"));
      assert.match(await readFile(join(output, "out", "box.conf"), "utf8"), /FINAL,DIRECT/);
    } else {
      assert.equal(response.result.active, undefined);
      assert.match(response.result.hint, /out may be absent/);
      assert.ok(!(await readdir(output)).includes("out"));
      assert.ok((await readdir(output)).includes(".build-lock"));
    }
  }
});
