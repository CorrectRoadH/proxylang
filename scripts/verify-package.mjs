import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "proxylang-package-"));
const run = (command, args, cwd = temp) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  const [pack] = JSON.parse(
    run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], root),
  );
  const paths = pack.files.map((file) => file.path);
  assert.ok(
    paths.includes("dist/index.js") &&
      paths.includes("dist/index.d.ts") &&
      paths.includes("dist/cli.js"),
  );
  for (const path of paths)
    assert.match(path, /^(package\.json|README\.md|dist\/[a-zA-Z0-9_-]+\.(js|d\.ts))$/);
  writeFileSync(join(temp, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(temp, pack.filename)]);
  writeFileSync(
    join(temp, "config.ts"),
    `
    import {defineConfig, direct, match, rule, ruleSet} from 'proxylang';
    const local = ruleSet({id:'local',when:match.domainSuffix('example.com')});
    export default defineConfig({
      programs:{home:{engine:'sing-box',nodes:[],groups:[],routing:[rule('local',local,direct())],fallback:direct()}},
      targets:[{id:'home',program:'home',engine:'sing-box',platform:'linux',version:'1.12.0'}],
    });
  `,
  );
  const sdk = run(process.execPath, [
    "--input-type=module",
    "-e",
    "import {ruleSet} from 'proxylang'; if(typeof ruleSet !== 'function') process.exit(1)",
  ]);
  assert.equal(sdk, "");
  writeFileSync(
    join(temp, "nodes.ts"),
    `
    import {proxy,secret,compileProxyNodes,renderProxyNodes,type ProxyNodeInput} from 'proxylang';
    const node=proxy.builder(proxy.http({id:'exit',server:'proxy.example.com',port:8080,password:secret('PASS')})).via('relay').build();
    const input:ProxyNodeInput={target:{engine:'surge',platform:'macos',version:'6.10.0'},nodes:[node],names:{exit:'出口'},externals:[{id:'relay',nativeName:'Relay Group',kind:'group'}]};
    const compiled=compileProxyNodes(input);
    if(!compiled.ok) throw Error('fragment compilation failed');
    const artifact=renderProxyNodes(compiled,()=> 'test-only');
    if(artifact.entries.length!==1 || !artifact.content.includes('underlying-proxy=Relay Group')) throw Error('fragment encoding failed');
  `,
  );
  assert.equal(run(process.execPath, ["nodes.ts"]), "");
  const cli = join(temp, "node_modules/.bin/proxylang");
  assert.equal(JSON.parse(run(cli, ["check", "config.ts"])).ok, true);
  assert.equal(JSON.parse(run(cli, ["build", "config.ts", "--out", "out"])).published, true);
  const active = JSON.parse(readFileSync(join(temp, "out/active.json"), "utf8"));
  assert.ok(active.artifacts.home);
  run(process.execPath, [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--target",
    "es2024",
    "--module",
    "nodenext",
    "config.ts",
    "nodes.ts",
  ]);
  if (process.argv.includes("--keep")) {
    const output = resolve(root, ".cache/release");
    rmSync(output, { recursive: true, force: true });
    mkdirSync(output, { recursive: true });
    copyFileSync(join(temp, pack.filename), join(output, pack.filename));
  }
  console.log(
    `Verified ${pack.filename}: file allowlist, isolated SDK, types, CLI check and build`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
