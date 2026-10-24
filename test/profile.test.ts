import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compileProfile,
  defineProfile,
  defineProxyGroup,
  defineRoute,
  defineBuild,
  runBuild,
  group,
  match,
  outbound,
  proxy,
  secret,
  surge,
  type Profile,
  type ProfileDefinition,
} from "../src/index.js";

const node = () =>
  proxy.trojan({
    id: "edge",
    server: "192.0.2.1",
    port: 443,
    password: secret("PASS"),
    serverName: "example.com",
  });
function fixture(engine: "surge" | "sing-box" = "surge") {
  const edge = node();
  const choice = defineProxyGroup({
    id: "choice",
    name: "Choice",
    algorithm: group.select(),
    members: [edge],
  });
  return {
    target:
      engine === "surge"
        ? ({ engine, platform: "macos", version: "6.10.0" } as const)
        : ({ engine, platform: "linux", version: "1.12.0" } as const),
    proxies: [edge],
    groups: [choice],
    routes: [defineRoute({ when: match.domain("example.com"), to: choice })],
    fallback: choice,
  };
}
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("portable profiles isolate mutation while keeping destination identity across snapshots", () => {
  const input = fixture();
  const profile = defineProfile(input);
  Object.assign(input.proxies[0]!, { server: "bad" }); // original authoring object stays mutable
  assert.equal(
    "server" in profile.proxies[0]! ? profile.proxies[0]!.server : undefined,
    "192.0.2.1",
  );
  assert.equal(profile.groups[0]!.members[0], profile.proxies[0]);
  assert.equal(profile.routes[0]!.to, profile.groups[0]);
  assert.equal(profile.fallback, profile.groups[0]);
  assert.equal(Object.isFrozen(profile.groups[0]!.members), true);
  assert.equal(compileProfile(profile).ok, true);
  assert.equal(compileProfile(defineProfile(fixture("sing-box"))).ok, true);
  assert.equal(compileProfile({ ...fixture(), fallback: { ...node() } }).ok, false);
  let reads = 0;
  const accessor = {
    ...fixture(),
    get surge() {
      reads++;
      return {};
    },
  };
  assert.throws(() => defineProfile(accessor));
  assert.equal(reads, 0);
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("Surge adaptation recursively lowers portable conditions without dropping options", () => {
  const base = fixture();
  const compile = (when: unknown) =>
    compileProfile({
      ...base,
      routes: [defineRoute({ when: when as never, to: outbound.direct })],
    });
  assert.equal(compile(match.ipCidr("2001:db8::/32")).ok, true);
  assert.equal(compile({ type: "all", conditions: [match.domain("example.com")] }).ok, true);
  assert.equal(
    compile({ type: "ruleSet", id: "named", when: match.ipCidr("2001:db8::/32") }).ok,
    true,
  );
  assert.equal(compile(surge.ruleSet({ id: "native", url: "https://example.com/rules" })).ok, true);
  for (const when of [
    { type: "all", conditions: [match.domain("example.com")], noResolve: true },
    { type: "domain", value: "example.com", typo: true },
    { type: "ruleSet", id: "named", when: match.domain("example.com"), typo: true },
    match.not(
      surge.ruleSet({ id: "native", url: "https://example.com/rules", intervalSeconds: 60 }),
    ),
  ])
    assert.equal(compile(when).ok, false);
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("sing-box refuses Surge extensions and top-level group probes; urltest lives in algorithm", () => {
  const base = fixture("sing-box");
  assert.equal(compileProfile({ ...base, surge: surge.config({ general: {} }) }).ok, false);
  assert.equal(
    compileProfile({
      ...base,
      routes: [
        defineRoute({
          when: surge.match.domain("example.com", { extendedMatching: true }),
          to: base.fallback,
        }),
      ],
    }).ok,
    false,
  );
  for (const options of [
    { url: "https://example.com" },
    { intervalSeconds: 30 },
    { timeoutSeconds: 5 },
  ]) {
    const { type: _type, ...input } = base.groups[0]!;
    const choice = defineProxyGroup({ ...input, ...options });
    assert.equal(
      compileProfile({ ...base, groups: [choice], routes: [], fallback: choice }).ok,
      false,
    );
  }
  const { type: _type, ...input } = base.groups[0]!;
  const choice = defineProxyGroup({
    ...input,
    algorithm: group.urltest({ url: "https://example.com", intervalSeconds: 60 }),
  });
  assert.equal(
    compileProfile({ ...base, groups: [choice], routes: [], fallback: choice }).ok,
    true,
  );
  assert.equal(compileProfile({ ...base, singBox: { mode: "standalone" } }).ok, false);
});
// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("mixed builds compile everything before one shared secret read and publish both formats", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "portable-profile-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let reads = 0;
  const profiles = { mac: defineProfile(fixture()), linux: defineProfile(fixture("sing-box")) };
  const build = defineBuild({
    profiles,
    resolveSecret: () => {
      reads++;
      return "fixture-password";
    },
    preflight: () => {
      profiles.mac = {} as Profile;
      return [];
    },
  });
  const result = await runBuild(build, root);
  assert.equal(result.exitCode, 0);
  assert.equal(reads, 1);
  assert.deepEqual((await readdir(join(root, "out"))).sort(), ["linux.json", "mac.conf"]);
  const json = JSON.parse(await readFile(join(root, "out/linux.json"), "utf8"));
  assert.equal(json.route.final, "choice");
  assert.equal(
    json.outbounds.find((outbound: { tag: string }) => outbound.tag === "edge").password,
    "fixture-password",
  );
  const old = await readFile(join(root, "out/mac.conf"), "utf8");
  reads = 0;
  const invalid = await runBuild(
    {
      profiles: { mac: build.profiles.mac!, bad: { ...fixture("sing-box"), surge: {} } },
      resolveSecret: () => {
        reads++;
        return "private";
      },
    },
    root,
  );
  assert.equal(invalid.exitCode, 1);
  assert.equal(reads, 0);
  assert.equal(await readFile(join(root, "out/mac.conf"), "utf8"), old);
});
// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("endpoint state overlap is rejected before secrets or filesystem publication", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "portable-state-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  for (const stateDirectory of [root, join(root, "state"), tmpdir()]) {
    let reads = 0;
    const endpoint = {
      type: "sing-box-tailscale" as const,
      id: "tailnet",
      stateDirectory,
      hostname: "fixture",
      acceptRoutes: true,
      bootstrapResolver: "1.1.1.1",
      authKey: secret("TAIL_KEY"),
    };
    const base = fixture("sing-box");
    const profile = {
      ...base,
      proxies: [...base.proxies, endpoint],
      singBox: { mode: "standalone" as const, listener: { port: 1080, resolver: "1.1.1.1" } },
    };
    const result = await runBuild(
      {
        profiles: { linux: defineProfile(profile as ProfileDefinition) },
        resolveSecret: () => {
          reads++;
          return "fixture";
        },
      },
      root,
    );
    assert.equal(result.code, "ENDPOINT_STATE_OVERLAP");
    assert.equal(reads, 0);
    assert.deepEqual(await readdir(root), []);
  }
});

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("shared condition DAGs cannot evade lowering budgets or logical depth", () => {
  let condition: unknown = match.domain("example.com");
  for (let i = 0; i < 17; i++) condition = { type: "all", conditions: [condition, condition] };
  const result = compileProfile({
    ...fixture(),
    routes: [defineRoute({ when: condition as never, to: outbound.direct })],
  });
  assert.equal(result.engine, "invalid");
  if (result.engine === "invalid") assert.equal(result.code, "DEFINITION_OUTPUT_BUDGET_EXCEEDED");
  condition = match.domain("example.com");
  for (let i = 0; i < 11; i++) condition = { type: "all", conditions: [condition] };
  const deep = compileProfile({
    ...fixture(),
    routes: [defineRoute({ when: condition as never, to: outbound.direct })],
  });
  assert.equal(deep.engine, "invalid");
  if (deep.engine === "invalid") assert.equal(deep.code, "LOGICAL_DEPTH_EXCEEDED");
});
