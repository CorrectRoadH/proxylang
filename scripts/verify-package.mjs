import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = process.cwd(),
  temp = mkdtempSync(join(tmpdir(), "proxylang-package-"));
const run = (cmd, args, cwd = temp) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  const [pack] = JSON.parse(
    run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], root),
  );
  for (const entry of pack.files)
    assert.match(entry.path, /^(package\.json|README\.md|dist\/[a-zA-Z0-9_-]+\.(js|d\.ts))$/);
  for (const name of ["dist/index.js", "dist/index.d.ts", "dist/cli.js"])
    assert.ok(pack.files.some((f) => f.path === name));
  writeFileSync(join(temp, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(temp, pack.filename)]);
  const cli = join(temp, "node_modules/proxylang/dist/cli.js");
  const config = `import {defineBuild,defineProfile,defineRoutes,match,outbound,proxy,secret,secrets} from 'proxylang';
 const edge=proxy.trojan({id:'edge',server:'192.0.2.10',port:443,password:secret('TEST_PASSWORD')});
 export default defineBuild({outDir:'generated',profiles:{laptop:defineProfile({target:{engine:'surge',platform:'macos',version:'6.10.0'},proxies:[edge],groups:[],routes:defineRoutes({when:[match.domain('example.com')],to:edge}),fallback:outbound.direct})},secrets:secrets({env:['TEST_PASSWORD'],validation:{TEST_PASSWORD:'test-only'}})});`;
  for (const format of ["module", "commonjs"]) {
    const cwd = join(temp, format);
    mkdirSync(cwd);
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ type: format }));
    writeFileSync(join(cwd, "proxylang.config.ts"), config);
    assert.equal(JSON.parse(run(process.execPath, [cli, "check"], cwd)).ok, true);
    assert.equal(
      JSON.parse(run(process.execPath, [cli, "build", "--validation"], cwd)).published,
      true,
    );
    assert.ok(readFileSync(join(cwd, "generated/out/laptop.conf"), "utf8").length);
    let explain;
    try {
      run(process.execPath, [cli, "explain", "--target", "laptop", "--request", "{}"], cwd);
    } catch (e) {
      explain = JSON.parse(e.stdout);
    }
    assert.equal(explain.code, "EXPLAIN_PROFILE_UNSUPPORTED");
  }
  run(process.execPath, [
    "--input-type=module",
    "-e",
    `import * as sdk from 'proxylang'; for(const name of ['compile','render','compileProfile','defineRoute','defineConfig','policy','strategy','targetCatalog']) if(name in sdk)throw Error(name);`,
  ]);
  writeFileSync(
    join(temp, "types.ts"),
    readFileSync(join(root, "test/types/contracts.ts"), "utf8"),
  );
  run(process.execPath, [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--module",
    "nodenext",
    "--target",
    "es2023",
    "types.ts",
  ]);
  if (process.argv.includes("--keep")) {
    const dest = resolve(root, ".cache/release");
    mkdirSync(dest, { recursive: true });
    copyFileSync(join(temp, pack.filename), join(dest, pack.filename));
  }
  console.log(
    `Verified ${pack.filename}: allowlist, isolated SDK/types, ESM/CJS CLI check/build and explain rejection`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
