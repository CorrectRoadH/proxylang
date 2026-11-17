import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { checkBuild, defineBuild, proxy, secret, match, defineRoutes, outbound } from "proxylang";
import { scenarioDefinition, scenarioProfile, scenarios } from "../fixtures/scenarios.js";
const scenario = scenarios.find(
  (s) =>
    s.engine === "sing-box" &&
    s.version === "1.14.4" &&
    s.mode === "standalone" &&
    s.scene === "protocols",
)!;
const check = (p: Parameters<typeof defineBuild>[0]["profiles"][string]) =>
  checkBuild(defineBuild({ profiles: { fixture: p } }));
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
    assert.equal(check({ ...p, proxies: [{ ...p.proxies[0], ...patch }] as never }).ok, false);
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
    password: secret("TEST_PASSWORD"),
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
