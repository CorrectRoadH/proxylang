import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import * as sdk from "proxylang";
import {
  defineProfile,
  defineBuild,
  defineProxyGroup,
  defineRoutes,
  checkBuild,
  group,
  proxy,
  match,
  secret,
  surge,
} from "proxylang";
const edge = () =>
  proxy.trojan({ id: "edge", server: "192.0.2.10", port: 443, password: secret("TEST_PASSWORD") });
const fixture = () => {
  const n = edge();
  return {
    target: { engine: "surge", platform: "macos", version: "6.10.0" } as const,
    proxies: [n],
    groups: [],
    routes: defineRoutes({ when: [match.domain("example.com")], to: n }),
    fallback: n,
  };
};
const check = (p: Parameters<typeof defineProfile>[0]) =>
  checkBuild(defineBuild({ profiles: { fixture: p } }));
// @feature docs/feature/profile/library/README.md
test("only the Profile authoring and build pipeline is public", () => {
  for (const name of [
    "compile",
    "render",
    "buildToDirectory",
    "explain",
    "targetCatalog",
    "policy",
    "use",
    "slot",
    "rule",
    "block",
    "sequence",
    "defineConfig",
    "strategy",
    "direct",
    "reject",
    "route",
    "compileStrategyGroups",
    "compileProxyNodes",
    "renderProxyNodes",
    "compileSurgeProfile",
    "renderSurgeProfile",
    "renderSurgeProfiles",
    "compileProfile",
    "defineRoute",
  ])
    assert.equal(name in sdk, false, name);
  assert.equal("config" in surge, false);
  for (const name of [
    "domain",
    "domainSuffix",
    "ipCidr",
    "sourceIp",
    "port",
    "sourcePort",
    "network",
    "all",
    "any",
    "not",
    "processName",
  ])
    assert.equal(name in surge.match, false, name);
});
// @feature docs/feature/profile/library/README.md#输入快照与预算
test("snapshots preserve aliases and isolate mutable author containers", () => {
  const input = fixture();
  const p = defineProfile({ ...input, proxies: [[input.proxies]], routes: [[input.routes]] });
  Object.assign(input.proxies[0]!, { server: "192.0.2.20" });
  assert.equal((p.proxies[0] as ReturnType<typeof edge>).server, "192.0.2.10");
  assert.equal(p.routes[0]!.to, p.proxies[0]);
  assert.equal(p.fallback, p.proxies[0]);
  assert.equal(Object.isFrozen(p.routes), true);
  assert.equal(check(p).ok, true);
  let reads = 0;
  assert.throws(() =>
    defineProfile({
      ...fixture(),
      get surge() {
        reads++;
        return {};
      },
    }),
  );
  assert.equal(reads, 0);
  const cycle: unknown[] = [];
  cycle.push(cycle);
  assert.throws(() => defineProfile({ ...fixture(), routes: cycle as never }));
  let dag: unknown[] = [];
  for (let i = 0; i < 20; i++) dag = [dag, dag];
  assert.throws(() => defineProfile({ ...fixture(), routes: dag as never }));
});
// @feature docs/feature/targets/README.md#资源图
test("unknown objects, duplicate resources and resource cycles fail check without secret reads", () => {
  const f = fixture();
  assert.equal(check({ ...f, fallback: { ...edge() } }).ok, false);
  assert.equal(check({ ...f, proxies: [f.proxies[0]!, edge()] }).ok, false);
  assert.equal(check({ ...f, proxies: [proxy.trojan({ ...edge(), via: "edge" })] }).ok, false);
  const n = proxy.http({
    id: "tcp",
    server: "192.0.2.20",
    port: 8080,
    password: secret("TEST_PASSWORD"),
  });
  assert.equal(check({ ...f, proxies: [n], routes: [], fallback: n }).ok, true); // Surge native UDP rejection is its explicit target behavior.
  const linux = {
    ...f,
    target: { engine: "sing-box", platform: "linux", version: "1.12.0" } as const,
    singBox: { mode: "fragment" as const },
    proxies: [n],
    routes: [],
    fallback: n,
  };
  assert.equal(check(linux).ok, false);
});
// @feature docs/feature/targets/README.md#能力
for (const engine of ["sing-box", "mihomo", "stash"] as const)
  test(`${engine} Profile checks exact targets and engine extension boundaries`, () => {
    const f = fixture();
    const target = {
      engine,
      platform: "linux",
      version: engine === "sing-box" ? "1.12.0" : engine === "mihomo" ? "1.19.32" : "4.2.1",
    } as const;
    const p = {
      ...f,
      target,
      ...(engine === "sing-box" ? { singBox: { mode: "fragment" as const } } : {}),
    };
    assert.equal(check(p).ok, engine !== "stash");
    assert.equal(check({ ...p, target: { ...target, version: "0.0.0" } }).ok, false);
    assert.equal(check({ ...p, surge: {} }).ok, false);
  });
// @feature docs/feature/profile/library/README.md#分组算法
test("auto chooses each engine mechanism and Stash rejects unsupported algorithms", () => {
  const n = edge();
  const automatic = defineProxyGroup({
    id: "automatic",
    name: "Automatic",
    algorithm: group.auto(),
    members: [n],
  });
  const base = { ...fixture(), proxies: [n], groups: [automatic], routes: [], fallback: automatic };
  assert.equal(check(base).ok, true);
  assert.equal(
    check({ ...base, target: { engine: "mihomo", platform: "linux", version: "1.19.32" } }).ok,
    true,
  );
  assert.equal(
    check({ ...base, target: { engine: "stash", platform: "macos", version: "4.2.1" } }).ok,
    false,
  );
});
