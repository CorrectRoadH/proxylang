import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  checkBuild,
  defineBuild,
  proxy,
  defineProfile,
  match,
  defineRoutes,
  outbound,
} from "proxylang";
import {
  scenarioDefinition,
  scenarioProfile,
  scenarios,
  fixtureSecrets,
} from "../fixtures/scenarios.js";
const scenario = scenarios.find(
  (s) =>
    s.engine === "sing-box" &&
    s.version === "1.14.4" &&
    s.mode === "standalone" &&
    s.scene === "protocols",
)!;
const check = (p: unknown) =>
  checkBuild(
    defineBuild({ profiles: { fixture: defineProfile(p as never) }, secrets: fixtureSecrets }),
  );
// @feature docs/feature/profile/library/proxies.md
for (const patch of [
  { port: 0 },
  { port: 65536 },
  { region: "TEST" },
  { provider: "TEST" },
  { tags: [] },
  { uuid: { type: "env", name: "TEST_UUID" } },
  { surge: { udpRelay: false } },
])
  test(`strict protocol fields reject ${Object.keys(patch).join(",")}`, () => {
    const p = scenarioProfile(scenario);
    assert.throws(() => proxy.trojan({ ...p.proxies[0], ...patch } as never));
  });
// @feature docs/feature/profile/library/sing-box.md#版本与模式矩阵
for (const version of ["1.12.0", "1.14.4"])
  for (const mode of ["standalone", "fragment"] as const)
    for (const field of ["cacheFile", "domainMatching", "tun"] as const)
      test(`${version} ${mode} ${field} capability`, () => {
        const p = scenarioDefinition({
          ...scenario,
          version,
          mode,
          scene: field === "tun" ? "tun" : "modern",
        });
        const extension = p.singBox!;
        const value =
          field === "cacheFile"
            ? true
            : field === "domainMatching"
              ? "prefer-sniffed"
              : {
                  address: ["192.0.2.1/24"],
                  stack: "mixed",
                  autoRoute: true,
                  strictRoute: true,
                  dnsMode: "hijack",
                };
        const clean = {
          mode,
          ...(mode === "standalone"
            ? { listener: { port: 16900, resolver: "2001:db8:1::53" } }
            : {}),
          [field]: value,
        };
        assert.equal(
          check({ ...p, singBox: clean as typeof extension }).ok,
          version === "1.14.4" && (field === "domainMatching" || mode === "standalone"),
        );
      });

// @feature docs/feature/targets/README.md#资源图
test("TCP-only propagation retains nested Boolean proofs of network constraints", () => {
  const p = scenarioProfile(scenario);
  const node = proxy.http({
    id: "tcp",
    server: "192.0.2.20",
    port: 8080,
    password: fixtureSecrets.TEST_PASSWORD,
  });
  const cases = [
    [match.network("tcp"), true],
    [match.not(match.not(match.network("tcp"))), true],
    [match.any(match.network("tcp"), match.network("tcp")), true],
    [match.not(match.any(match.network("udp"), match.domain("example.com"))), true],
    [match.any(match.network("tcp"), match.domain("example.com")), false],
    [match.not(match.network("tcp")), false],
  ] as const;
  for (const [when, ok] of cases)
    assert.equal(
      check({
        ...p,
        proxies: [node],
        groups: [],
        routes: defineRoutes({ when: [when], to: node }),
        fallback: outbound.direct,
        singBox: { mode: "fragment" },
      }).ok,
      ok,
    );
});

// @feature docs/feature/targets/README.md#资源图
test("defensive dependency checking reports every id on a mixed group/via cycle", async () => {
  const { inspectProfile } = await import("../../src/model/inspect-profile.js");
  const { register } = await import("../../src/model/identity.js");
  const a = {
    type: "trojan",
    id: "node-a",
    server: "192.0.2.10",
    port: 443,
    password: fixtureSecrets.TEST_PASSWORD,
  } as Record<string, unknown>;
  const members: unknown[] = [a];
  const g = { type: "proxy-group", id: "group-b", algorithm: { type: "select" }, members };
  a.via = g;
  register(a, "node");
  register(g, "group");
  const result = inspectProfile(
    {
      target: { engine: "surge", platform: "macos", version: "6.10.0" },
      proxies: [a],
      groups: [g],
      routes: [],
      fallback: outbound.direct,
    } as never,
    "fixture",
    fixtureSecrets as never,
  );
  const diagnostic = result.diagnostics.find((d) => d.code === "GROUP_CYCLE");
  assert.ok(diagnostic);
  assert.match(diagnostic.message, /node-a/);
  assert.match(diagnostic.message, /group-b/);
});
