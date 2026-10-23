import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  existsSync,
} from "node:fs";
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
  writeFileSync(
    join(temp, "complete-profile.mjs"),
    `
    import assert from 'node:assert/strict';
    import {readFile, readlink} from 'node:fs/promises';
    import {runBuild, defineProfile, defineProxyGroup, group, proxy, secret} from 'proxylang';
    const nodes=[proxy.trojan({id:'edge',label:'Edge',region:'SG',server:'192.0.2.1',port:443,password:secret('PASS')})];
    const choice=defineProxyGroup({id:'choice',name:'Choice',algorithm:group.select(),members:nodes});
    const profile=defineProfile({target:{engine:'surge',platform:'macos',version:'6.10.0'},nodes,groups:[choice],routes:[],fallback:choice});
    let reads=0;
    const resolver=()=>{reads++;return 'fixture-pass';};
    const built=await runBuild({profiles:{first:profile,second:profile},resolveSecret:resolver},'complete-out');
    assert.equal(built.exitCode,0); assert.equal(reads,1);
    assert.match(await readFile('complete-out/out/first.conf','utf8'),/FINAL,Choice/);
    const old=await readlink('complete-out/out');
    reads=0;
    const failed=await runBuild({profiles:{first:profile,second:{...profile,fallback:proxy.http({id:'absent',server:'192.0.2.2',port:80,password:secret('PASS')})}},resolveSecret:resolver},'complete-out');
    assert.equal(failed.published,false); assert.equal(reads,0);
    assert.equal(await readlink('complete-out/out'),old);
  `,
  );
  assert.equal(run(process.execPath, ["complete-profile.mjs"]), "");
  assert.equal(
    run(process.execPath, [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import {defineProxyGroup,defineRoute,defineProfile,selectProxies,outbound,group,surge,proxy,secret,compileProfile} from 'proxylang';
    const node=proxy.http({id:'edge',server:'192.0.2.1',port:8080,password:secret('PASS')});
    const choice=defineProxyGroup({id:'choice',name:'Choice',algorithm:group.select(),members:selectProxies([node],{ids:['edge']})});
    const input=defineProfile({target:{engine:'surge',platform:'macos',version:'6.10.0'},nodes:[node],groups:[choice],routes:[defineRoute({when:surge.match.domain('example.com'),to:outbound.direct})],fallback:choice});
    assert.equal(compileProfile(input).ok,true);
  `,
    ]),
    "",
  );
  assert.equal(
    run(process.execPath, [
      "--input-type=module",
      "-e",
      `
    import * as sdk from 'proxylang';
    for (const name of ['defineSurgeProfile','defineSurgeBuild','runSurgeBuild','surgeProfile','surgeMembers','buildSurgeProfilesToDirectory','lowerSurgeProfile'])
      if(name in sdk) throw Error('removed/internal export: '+name);
  `,
    ]),
    "",
  );
  writeFileSync(
    join(temp, "removed-command.mjs"),
    "import {writeFileSync} from 'node:fs'; writeFileSync('removed-loaded','bad');",
  );
  assert.throws(() =>
    run(process.execPath, [
      join(temp, "node_modules/proxylang/dist/cli.js"),
      "surge-build",
      "removed-command.mjs",
      "--out",
      "removed-out",
    ]),
  );
  assert.equal(existsSync(join(temp, "removed-loaded")), false);
  writeFileSync(
    join(temp, "removed-types.ts"),
    `
    // @ts-expect-error removed public type
    import type {Destination} from 'proxylang';
    // @ts-expect-error removed public type
    import type {SurgeProfileDefinition} from 'proxylang';
    // @ts-expect-error removed public type
    import type {SurgeBuildDefinition} from 'proxylang';
    // @ts-expect-error removed public type
    import type {SurgeBuildContext} from 'proxylang';
    // @ts-expect-error removed public type
    import type {SurgeBuildResult} from 'proxylang';
  `,
  );
  writeFileSync(
    join(temp, "profile-build.ts"),
    `
    import {defineBuild,defineProfile,defineRoute,match,outbound,proxy,secret,defineProxyGroup,group} from 'proxylang';
    const edge=proxy.trojan({id:'edge',server:'192.0.2.1',port:443,password:secret('PASS')});
    const choice=defineProxyGroup({id:'choice',name:'Choice',algorithm:group.select(),members:[edge]});
    const common={nodes:[edge],groups:[choice],routes:[defineRoute({when:match.ipCidr('2001:db8::/32'),to:choice})],fallback:outbound.direct};
    export default defineBuild({profiles:{mac:defineProfile({...common,target:{engine:'surge',platform:'macos',version:'6.10.0'}}),linux:defineProfile({...common,target:{engine:'sing-box',platform:'linux',version:'1.12.0'}})},resolveSecret:()=> 'fixture'});
  `,
  );
  const portableResult = JSON.parse(
    run(process.execPath, [
      join(temp, "node_modules/proxylang/dist/cli.js"),
      "profile-build",
      "profile-build.ts",
      "--out",
      "profile-build-out",
      "--validation",
    ]),
  );
  assert.equal(portableResult.published, true);
  assert.equal(portableResult.profileCount, 2);
  assert.match(readFileSync(join(temp, "profile-build-out/out/mac.conf"), "utf8"), /IP-CIDR6/);
  assert.equal(
    JSON.parse(readFileSync(join(temp, "profile-build-out/out/linux.json"), "utf8")).route.final,
    "pl-direct",
  );
  writeFileSync(
    join(temp, "type-contracts.ts"),
    readFileSync(join(root, "test/type-contracts.ts"), "utf8").replace(
      '"../src/index.js"',
      '"proxylang"',
    ),
  );
  writeFileSync(
    join(temp, "automatic.ts"),
    `
    import {defineConfig, strategy, group, direct, route, rule, match, secret} from 'proxylang';
    export default defineConfig({
      programs:{home:{engine:'sing-box',nodes:[{id:'edge',type:'trojan',server:'192.0.2.1',port:443,password:secret('AUTO_PASS')}],
        groups:[strategy({id:'automatic',members:['edge'],algorithm:group.auto()})],
        routing:[rule('web',match.domain('example.com'),route('automatic'))],fallback:direct()}},
      targets:[{id:'home',program:'home',engine:'sing-box',platform:'linux',version:'1.12.0'}],
    });
  `,
  );
  const cli = join(temp, "node_modules/.bin/proxylang");
  const automatic = JSON.parse(run(cli, ["check", "automatic.ts"]));
  assert.equal(automatic.ok, true);
  assert.deepEqual(automatic.targets[0].strategySelections[0].requestedAlgorithm, { type: "auto" });
  assert.equal(automatic.targets[0].strategySelections[0].algorithm.type, "urltest");
  assert.equal(
    JSON.parse(
      run(cli, [
        "explain",
        "automatic.ts",
        "--target",
        "home",
        "--request",
        '{"network":"tcp","domain":"example.com"}',
      ]),
    ).action.to,
    "automatic",
  );
  writeFileSync(join(temp, "请求 信息.json"), '\ufeff{"network":"tcp","domain":"example.com"}');
  assert.equal(
    JSON.parse(
      run(cli, ["explain", "automatic.ts", "--target", "home", "--request-file", "请求 信息.json"]),
    ).action.to,
    "automatic",
  );
  assert.ok(
    JSON.parse(run(cli, ["explain", "--help"])).usage.some((line) =>
      line.includes("--request-file"),
    ),
  );
  const automaticOut = join(temp, "automatic-out");
  execFileSync(cli, ["build", "automatic.ts", "--out", automaticOut], {
    cwd: temp,
    env: { ...process.env, AUTO_PASS: "package-test-only" },
    stdio: "pipe",
  });
  const automaticPointer = JSON.parse(readFileSync(join(automaticOut, "active.json"), "utf8"));
  const automaticManifest = JSON.parse(
    readFileSync(join(automaticOut, automaticPointer.manifest), "utf8"),
  );
  assert.deepEqual(
    automaticManifest.targets[0].strategySelections,
    automatic.targets[0].strategySelections,
  );

  assert.equal(JSON.parse(run(cli, ["check", "config.ts"])).ok, true);
  assert.equal(
    JSON.parse(
      run(cli, [
        "explain",
        "config.ts",
        "--target",
        "home",
        "--request",
        '{"network":"tcp","domain":"example.com"}',
      ]),
    ).rule,
    "home/local",
  );
  mkdirSync(join(temp, "commonjs"));
  writeFileSync(join(temp, "commonjs/package.json"), JSON.stringify({ type: "commonjs" }));
  writeFileSync(
    join(temp, "commonjs/config.ts"),
    "export default {programs:{home:{engine:'sing-box',nodes:[],groups:[],routing:[],fallback:{type:'direct'}}},targets:[{id:'home',program:'home',engine:'sing-box',platform:'linux',version:'1.12.0'}]};",
  );
  assert.equal(JSON.parse(run(cli, ["check", "commonjs/config.ts"])).ok, true);
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
    "type-contracts.ts",
    "removed-types.ts",
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
