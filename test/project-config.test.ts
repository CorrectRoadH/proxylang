import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  readFile,
  rm,
  realpath,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkBuild, defineBuild, outbound } from "../src/index.js";
const exec = promisify(execFile);
const name = "proxylang.config.ts";
const profile = {
  target: { engine: "surge", platform: "macos", version: "6.10.0" } as const,
  proxies: [],
  groups: [],
  routes: [],
  fallback: outbound.direct,
};
const cli = resolve("dist/cli.js");
const sdk = pathToFileURL(resolve("dist/index.js")).href;
async function workspace(t: { onTestFinished(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "project-config-")));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function call(root: string, args: string[]) {
  try {
    const result = await exec(process.execPath, [cli, ...args], { cwd: root });
    return { status: 0, ...result, json: JSON.parse(result.stdout) };
  } catch (cause) {
    const result = cause as { code: number; stdout: string; stderr: string };
    return { status: result.code, ...result, json: JSON.parse(result.stdout) };
  }
}
// @feature docs/feature/artifact-publication/project-config.md
test("checkBuild shares batch validation without callbacks, secrets or output writes", async (t) => {
  const root = await workspace(t);
  let calls = 0;
  const definition = {
    outDir: root,
    profiles: { mac: profile },
    preflight: () => {
      calls++;
      throw Error("private");
    },
    resolveSecret: () => {
      calls++;
      throw Error("private");
    },
  };
  const snapshot = defineBuild(definition);
  definition.outDir = "changed";
  assert.equal(snapshot.outDir, root);
  const result = checkBuild(snapshot);
  assert.equal(result.ok, true);
  assert.equal(result.code, "CHECKED");
  assert.equal(result.outputDirectoryChecked, true);
  assert.equal(result.profiles[0]!.engine, "surge");
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(root), []);
  assert.equal(checkBuild({ profiles: { mac: profile } }).outputDirectoryChecked, false);
  assert.equal(checkBuild({ profiles: {} }).code, "INVALID_PROFILE_FILENAMES");
  const endpointProfile = {
    target: { engine: "sing-box", platform: "linux", version: "1.12.0" } as const,
    proxies: [
      {
        type: "sing-box-tailscale",
        id: "tailnet",
        stateDirectory: root,
        hostname: "fixture",
        acceptRoutes: true,
        bootstrapResolver: "1.1.1.1",
      } as const,
    ],
    groups: [],
    routes: [],
    fallback: outbound.direct,
    singBox: { mode: "standalone" as const, listener: { port: 1080, resolver: "1.1.1.1" } },
  };
  const overlap = checkBuild({ outDir: root, profiles: { linux: endpointProfile } });
  assert.equal(overlap.code, "ENDPOINT_STATE_OVERLAP");
  assert.equal(overlap.outputDirectoryChecked, true);

  assert.equal(checkBuild({ profiles: { "../bad": profile } }).profiles.length, 0);
  assert.equal(checkBuild({ profiles: { mac: { ...profile, fallback: "missing" } } }).ok, false);
  assert.equal(checkBuild({ ...snapshot, outDir: " bad " }).code, "INVALID_BUILD_DEFINITION");
});
// @feature docs/feature/artifact-publication/project-config.md
test("CLI requires local convention, rejects retired syntax before import, and preserves error precedence", async (t) => {
  const root = await workspace(t);
  const child = join(root, "child");
  await mkdir(child);
  await writeFile(join(root, name), `throw Error('private-import');`);
  assert.equal((await call(child, ["check"])).json.code, "CONFIG_NOT_FOUND");
  await mkdir(join(child, name));
  assert.equal((await call(child, ["check"])).json.code, "CONFIG_LOAD_FAILED");
  await rm(join(child, name), { recursive: true });
  await symlink(join(root, "missing.ts"), join(child, name));
  assert.equal((await call(child, ["check"])).json.code, "CONFIG_LOAD_FAILED");
  await rm(join(child, name));

  const marker = join(root, "loaded");
  await writeFile(
    join(root, name),
    `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'yes'); throw Error('private-import');`,
  );
  for (const args of [
    ["profile-build"],
    ["build", "--out", "out"],
    ["check", "old.ts"],
    ["check", "--config", name],
    ["explain", "--target", "box", "--request", "{}", "--request-file", "x"],
    ["build", "--validation", "--validation"],
  ]) {
    assert.equal((await call(root, args)).json.code, "INVALID_ARGUMENTS");
  }
  assert.equal((await call(root, ["check", "--help"])).status, 0);
  assert.ok(!(await readdir(root)).includes("loaded"));
  const failed = await call(root, ["explain", "--target", "missing", "--request", "not-json"]);
  assert.equal(failed.json.code, "CONFIG_LOAD_FAILED");
  assert.ok(!(failed.stdout + failed.stderr).includes("private-import"));
  assert.ok((await readdir(root)).includes("loaded"));
  await writeFile(join(root, name), `import './absent.ts';`);
  assert.equal((await call(root, ["check"])).json.reason, "MODULE_NOT_FOUND");
  await writeFile(
    join(root, name),
    `export default {profiles:{mac:${JSON.stringify(profile)}},resolveSecret:()=>{throw Error('secret')},preflight:()=>{throw Error('callback')}};`,
  );
  assert.equal((await call(root, ["check"])).json.code, "CHECKED");
  assert.equal((await call(root, ["build"])).json.code, "OUTPUT_DIRECTORY_REQUIRED");
  assert.equal(
    (await call(root, ["explain", "--target", "mac", "--request", "{}"])).json.code,
    "EXPLAIN_PROFILE_UNSUPPORTED",
  );
  await writeFile(join(root, name), `export default {programs:{},targets:[]};`);
  assert.equal(
    (await call(root, ["build", "--validation"])).json.code,
    "VALIDATION_PROFILE_REQUIRED",
  );
});
// @feature docs/feature/artifact-publication/project-config.md
test("CLI import and SDK callbacks cannot redirect the captured output root", async (t) => {
  const root = await workspace(t);
  const changed = join(root, "changed");
  await mkdir(changed);
  const withSecret = {
    ...profile,
    surge: {
      managed: {
        url: "https://example.com/profile",
        query: { token: { type: "env", name: "TOKEN" } },
        intervalSeconds: 3600,
        strict: false,
      },
    },
  };
  await writeFile(
    join(root, name),
    `process.chdir(${JSON.stringify(changed)}); export default {outDir:'output',profiles:{mac:${JSON.stringify(withSecret)}},preflight:()=>{process.chdir(${JSON.stringify(root)});return []},resolveSecret:()=>{process.chdir(${JSON.stringify(changed)});return 'fixture'}};`,
  );
  const result = await call(root, ["build"]);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.active, join(root, "output/out"));
  assert.match(await readFile(join(root, "output/out/mac.conf"), "utf8"), /FINAL,DIRECT/);
  assert.deepEqual(await readdir(changed), []);
  const source = `import {runBuild} from ${JSON.stringify(sdk)}; const result=await runBuild({outDir:'ignored',profiles:{mac:${JSON.stringify(withSecret)}},preflight:()=>{process.chdir(${JSON.stringify(changed)});return []},resolveSecret:()=>{process.chdir(${JSON.stringify(changed)});return 'fixture'}},'sdk-output'); console.log(JSON.stringify(result));`;
  const direct = await exec(process.execPath, ["--input-type=module", "-e", source], { cwd: root });
  assert.equal(JSON.parse(direct.stdout).active, join(root, "sdk-output/out"));
  assert.match(await readFile(join(root, "sdk-output/out/mac.conf"), "utf8"), /FINAL,DIRECT/);
  assert.deepEqual(await readdir(changed), []);
});
