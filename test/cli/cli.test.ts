import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const cli = resolve("dist/cli.js");
const run = (cwd: string, args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return {
    status: r.status,
    result: JSON.parse(r.stdout) as { code?: string; ok?: boolean; published?: boolean },
  };
};
// @feature docs/feature/build/cli.md
for (const scope of ["module", "commonjs"])
  test(`CLI ${scope} loads Profile check/build and keeps failures controlled`, async () => {
    const root = await mkdtemp(join(tmpdir(), "proxylang-cli-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify({ type: scope }));
      assert.equal(run(root, ["check"]).result.code, "CONFIG_NOT_FOUND");
      assert.equal(run(root, ["build", "--config", "unsafe"]).result.code, "INVALID_ARGUMENTS");
      await writeFile(
        join(root, "proxylang.config.ts"),
        `import {defineBuild,defineProfile,outbound} from ${JSON.stringify(resolve("dist/index.js"))};export default defineBuild({outDir:'generated',profiles:{one:defineProfile({target:{engine:'surge',platform:'macos',version:'6.10.0'},proxies:[],groups:[],routes:[],fallback:outbound.direct})}});`,
      );
      assert.equal(run(root, ["check"]).result.ok, true);
      assert.equal((await readdir(root)).includes("generated"), false);
      assert.equal(run(root, ["build"]).result.published, true);
      await writeFile(join(root, "proxylang.config.ts"), `throw new Error('TEST_DO_NOT_ECHO');`);
      const failed = run(root, ["check"]);
      assert.equal(failed.status, 1);
      assert.equal(failed.result.code, "CONFIG_LOAD_FAILED");
      assert.doesNotMatch(JSON.stringify(failed.result), /TEST_DO_NOT_ECHO/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
// @feature docs/feature/build/format/project-config.md
test("help, targets and invalid arguments never execute configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-cli-"));
  try {
    await writeFile(join(root, "proxylang.config.ts"), `throw new Error('TEST_NOT_LOADED')`);
    assert.equal(run(root, ["targets"]).status, 0);
    assert.equal(run(root, ["--help"]).status, 0);
    assert.equal(run(root, ["build", "--unknown"]).result.code, "INVALID_ARGUMENTS");
    assert.equal(run(root, ["explain", "--request", "{}"]).result.code, "INVALID_ARGUMENTS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
