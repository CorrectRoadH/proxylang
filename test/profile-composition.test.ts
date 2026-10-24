import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as surgeSchema from "../src/surge-profile.js";
import {
  defineProfile,
  compileProfile,
  defineProxyGroup,
  defineRoutes,
  group,
  match,
  proxy,
  secret,
  runBuild,
  renderSurgeProfile,
  type ProfileDefinition,
  type SurgeTunnel,
} from "../src/index.js";

function fixture(engine: "surge" | "sing-box" = "surge") {
  const edge = proxy.trojan({
    id: "edge",
    label: "Edge",
    server: "192.0.2.1",
    port: 8080,
    password: secret("PASS"),
  });
  const choice = defineProxyGroup({
    id: "choice",
    name: "Choice",
    algorithm: group.select(),
    members: [edge],
  });
  const routes = defineRoutes({ when: [match.domain("example.com")], to: "choice" });
  return {
    target:
      engine === "surge"
        ? ({ engine, platform: "macos", version: "6.10.0" } as const)
        : ({ engine, platform: "linux", version: "1.12.0" } as const),
    proxies: [edge],
    groups: [choice],
    routes,
    fallback: "choice",
  };
}
function error(input: unknown, code: string) {
  const result = compileProfile(input as ProfileDefinition);
  assert.deepEqual(result, { engine: "invalid", ok: false, code });
}
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("fragments flatten in order, preserve aliases and merge General by whole keys", () => {
  const base = fixture();
  const dns = { "dns-server": ["1.1.1.1"], ipv6: false };
  const input = {
    ...base,
    proxies: [[], base.proxies],
    groups: [[base.groups]],
    routes: [base.routes, [], [base.routes]],
    surge: {
      general: [dns, [{ ipv6: true, "dns-server": ["9.9.9.9"] }]],
      hosts: [[{ pattern: "example.com", address: "192.0.2.1" }], []],
    },
  };
  const result = defineProfile(input);
  assert.deepEqual(result.surge?.general, { "dns-server": ["9.9.9.9"], ipv6: true });
  assert.deepEqual(Object.keys(result.surge!.general!), ["dns-server", "ipv6"]);
  assert.equal(result.routes.length, 2);
  assert.equal(result.groups[0]!.members[0], result.proxies[0]);
  assert.equal(result.routes[0], result.routes[1]);
  dns.ipv6 = true;
  dns["dns-server"].push("8.8.8.8");
  assert.deepEqual(defineProfile(result), result);
  assert.ok(Object.isFrozen(result.surge!.general!["dns-server"]));
  const compiled = compileProfile(result);
  assert.ok(compiled.engine === "surge" && compiled.ok);
  const text = renderSurgeProfile(compiled.compilation, () => "fixture").content;
  assert.match(text, /DOMAIN,example.com,Choice\nDOMAIN,example.com,Choice/);
  assert.match(text, /dns-server = 9.9.9.9/);
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("resource IDs resolve for both engines while object identity and explicit registration remain strict", () => {
  for (const engine of ["surge", "sing-box"] as const) {
    const base = fixture(engine);
    const choice = defineProxyGroup({
      id: "choice",
      name: "Choice",
      algorithm: group.select(),
      members: ["edge"],
    });
    assert.equal(compileProfile({ ...base, groups: [[choice]], routes: [base.routes] }).ok, true);
    error({ ...base, fallback: "Choice" }, "UNKNOWN_DESTINATION_ID");
    error({ ...base, fallback: "DIRECT" }, "UNKNOWN_DESTINATION_ID");
    error(
      { ...base, routes: defineRoutes({ when: [match.domain("bad.com")], to: "missing" }) },
      "UNKNOWN_DESTINATION_ID",
    );
    error(
      {
        ...base,
        groups: [
          defineProxyGroup({
            id: "choice",
            name: "Choice",
            algorithm: group.select(),
            members: ["missing"],
          }),
        ],
      },
      "UNKNOWN_DESTINATION_ID",
    );
    error({ ...base, fallback: { ...base.proxies[0]! } }, "UNREGISTERED_DESTINATION_INSTANCE");
    error({ ...base, proxies: [base.proxies, base.proxies] }, "DUPLICATE_RESOURCE_ID");
  }
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("unified proxies preserve protocol-specific fields and reject incompatible targets and cross-kind IDs", () => {
  const wg: SurgeTunnel = {
    type: "wireguard",
    id: "wg",
    sectionName: "WireGuard",
    privateKey: secret("KEY"),
    selfIp: "10.0.0.2",
    peers: [
      {
        publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        endpoint: "192.0.2.1:51820",
        allowedIps: ["0.0.0.0/0"],
      },
    ],
  };
  const tail: SurgeTunnel = {
    type: "tailscale",
    id: "tail",
    sectionName: "Tailnet",
    authKey: secret("KEY"),
    hostname: "fixture",
  };
  const base = fixture();
  assert.equal(
    compileProfile({ ...base, proxies: [base.proxies, [wg, tail]], fallback: "wg" }).ok,
    true,
  );
  error({ ...base, proxies: [base.proxies, { ...tail, id: "edge" }] }, "DUPLICATE_RESOURCE_ID");
  const linux = fixture("sing-box");
  error({ ...linux, proxies: [linux.proxies, wg] }, "PROFILE_ENDPOINT_UNSUPPORTED");
  error({ ...linux, proxies: [linux.proxies, tail] }, "PROFILE_ENDPOINT_UNSUPPORTED");
  const endpoint = {
    type: "sing-box-tailscale" as const,
    id: "tail",
    hostname: "fixture",
    stateDirectory: "/tmp/proxylang-state",
    acceptRoutes: true,
    bootstrapResolver: "1.1.1.1",
  };
  assert.equal(
    compileProfile({
      ...linux,
      proxies: [linux.proxies, endpoint],
      fallback: "tail",
      singBox: { mode: "standalone", listener: { port: 1080, resolver: "1.1.1.1" } },
    }).ok,
    true,
  );
  error({ ...base, proxies: [base.proxies, endpoint] }, "PROFILE_ENDPOINT_UNSUPPORTED");
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("normalization rejects accessors, cycles, old fields and excessive shared expansion", () => {
  const base = fixture();
  let reads = 0;
  const accessor = {
    get ipv6() {
      reads++;
      return true;
    },
  };
  error({ ...base, surge: { general: [accessor] } }, "DEFINITION_NOT_DATA");
  assert.equal(reads, 0);
  const cycle: unknown[] = [];
  cycle.push(cycle);
  error({ ...base, routes: cycle }, "DEFINITION_CYCLE");
  let deep: unknown = base.routes;
  for (let i = 0; i < 70; i++) deep = [deep];
  error({ ...base, routes: deep }, "DEFINITION_DEPTH_EXCEEDED");
  let shared: unknown = base.routes;
  for (let i = 0; i < 18; i++) shared = [shared, shared];
  error({ ...base, routes: shared }, "DEFINITION_OUTPUT_BUDGET_EXCEEDED");
  error({ ...base, nodes: [] }, "DEFINITION_UNKNOWN_FIELD");
  error({ ...base, endpoints: [] }, "DEFINITION_UNKNOWN_FIELD");
  error({ ...base, surge: { general: [{ ipv6: 1 }, { ipv6: true }] } }, "INVALID_SURGE_GENERAL");
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("General validation caches shared leaves only within one call and budgets shared nested data", (t) => {
  const validate = vi.spyOn(surgeSchema, "validateSurgeGeneral");
  t.onTestFinished(() => validate.mockRestore());
  const leaf = { "always-real-ip": Array.from({ length: 1000 }, (_, i) => `host${i}.example.com`) };
  let shared: unknown = leaf;
  for (let i = 0; i < 15; i++) shared = [shared, shared];
  const input = { ...fixture(), surge: { general: shared } } as ProfileDefinition;
  const profile = defineProfile(input);
  assert.equal(validate.mock.calls.length, 1);
  assert.deepEqual(profile.surge!.general, leaf);
  leaf["always-real-ip"][0] = "\ninvalid";
  assert.throws(() => defineProfile(input), /INVALID_SURGE_GENERAL/);
  assert.equal(validate.mock.calls.length, 2);
  leaf["always-real-ip"][0] = "example.com";
  error(
    { ...fixture(), surge: { general: Array.from({ length: 110 }, () => ({ ...leaf })) } },
    "DEFINITION_OUTPUT_BUDGET_EXCEEDED",
  );
});
// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("a later unresolved static route reads no secrets and preserves the previous generation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "profile-fragments-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const profile = defineProfile(fixture());
  const good = await runBuild({ profiles: { one: profile }, secrets: () => "fixture" }, root);
  assert.equal(good.exitCode, 0);
  const old = await readlink(join(root, "out"));
  const text = await readFile(join(root, "out/one.conf"), "utf8");
  let reads = 0;
  const bad = await runBuild(
    {
      profiles: { one: profile, two: { ...profile, fallback: "missing" } },
      secrets: () => {
        reads++;
        return "fixture";
      },
    },
    root,
  );
  assert.equal(bad.code, "UNKNOWN_DESTINATION_ID");
  assert.equal(reads, 0);
  assert.equal(await readlink(join(root, "out")), old);
  assert.equal(await readFile(join(root, "out/one.conf"), "utf8"), text);
});
