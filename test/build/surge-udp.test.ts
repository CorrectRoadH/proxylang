import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  defineBuild,
  defineProfile,
  defineRoutes,
  defineSecrets,
  defineProxyGroup,
  group,
  proxy,
  match,
  outbound,
  checkBuild,
  explainProfile,
  ProfileDefinitionError,
  type Exit,
  type Profile,
  type ProxyGroup,
  type SurgeGeneral,
} from "proxylang";
const secrets = defineSecrets({
  TEST_PASSWORD: { value: "test-only", validation: "test-only" },
  TEST_UUID: {
    value: "11111111-2222-4333-8444-555555555555",
    validation: "11111111-2222-4333-8444-555555555555",
  },
});
const http = (id: string, via?: Parameters<typeof proxy.http>[0]["via"]) =>
  proxy.http({
    id,
    server: "192.0.2.10",
    port: 8080,
    password: secrets.TEST_PASSWORD,
    ...(via ? { via } : {}),
  });
const udp = (id: string, via?: Parameters<typeof proxy.trojan>[0]["via"]) =>
  proxy.trojan({
    id,
    server: "192.0.2.20",
    port: 443,
    password: secrets.TEST_PASSWORD,
    ...(via ? { via } : {}),
  });
const select = (id: string, members: readonly Exit[]) =>
  defineProxyGroup({ id, algorithm: group.select(), members });
const make = (
  exit: Exit,
  proxies: Profile["proxies"],
  groups: readonly ProxyGroup[] = [],
  general?: SurgeGeneral | readonly SurgeGeneral[],
  tcp = false,
  ios = false,
) =>
  defineProfile({
    target: ios
      ? { engine: "surge", platform: "ios", version: "5.21.0" }
      : { engine: "surge", platform: "macos", version: "6.10.0" },
    proxies,
    groups,
    routes: defineRoutes({
      when: tcp ? match.network("tcp") : match.domain("example.com"),
      to: exit,
    }),
    fallback: tcp ? outbound.direct : exit,
    ...(general === undefined ? {} : { surge: { general } }),
  });
const reject = { "udp-policy-not-supported-behaviour": "REJECT" } as const;
const direct = { "udp-policy-not-supported-behaviour": "DIRECT" } as const;
const check = (p: ReturnType<typeof make>) =>
  checkBuild(defineBuild({ profiles: { one: p }, secrets }));
// @feature docs/feature/profile/library/surge.md#不支持-udp-的出口
test("explicit REJECT permits TCP-only terminals, mixed nested groups and fallback on both Surge targets", () => {
  const limited = [
    http("http"),
    proxy.vmess({ id: "vmess", server: "192.0.2.11", port: 443, uuid: secrets.TEST_UUID }),
    proxy.shadowsocks({
      id: "ss",
      server: "192.0.2.12",
      port: 443,
      method: "aes-128-gcm",
      password: secrets.TEST_PASSWORD,
      surge: { udpRelay: false },
    }),
  ];
  const capable = udp("udp");
  const mixed = select("mixed", [...limited, capable, outbound.direct]);
  const nested = select("nested", [mixed, outbound.reject]);
  for (const ios of [false, true])
    for (const exit of [...limited, mixed, nested]) {
      const p = make(exit, [...limited, capable], [mixed, nested], reject, false, ios);
      const result = check(p);
      assert.equal(result.ok, true, JSON.stringify(result));
      const explained = explainProfile(p, { domain: "example.com", network: "udp" });
      assert.ok(explained.ok);
      assert.equal(explained.explanation.exit, "builtin" in exit ? exit.builtin : exit.id);
    }
});
// @feature docs/feature/profile/library/surge.md#不支持-udp-的出口
test("DIRECT and omitted policy stay strict; merged fragments use only the final explicit value", () => {
  const node = http("http");
  for (const general of [undefined, direct, [reject, direct]]) {
    const p = make(node, [node], [], general);
    const result = check(p);
    assert.equal(result.code, "CHECK_FAILED");
    assert.deepEqual(
      result.profiles[0]?.diagnostics.filter((d) => d.code === "TCP_ONLY_EXIT").map((d) => d.path),
      ["routes[0].to", "fallback"],
    );
  }
  for (const general of [reject, [direct, reject]])
    assert.equal(check(make(node, [node], [], general)).ok, true);
  assert.equal(check(make(node, [node], [], undefined, true)).ok, true);
});
// @feature docs/feature/profile/library/surge.md#不支持-udp-的出口
test("REJECT exempts terminal capability but never any TCP-only via path", () => {
  const limited = http("limited"),
    capable = udp("capable");
  const mixed = select("mixed-relay", [limited, capable]);
  const udpRelay = select("udp-relay", [capable]);
  const deep = udp("deep", mixed);
  const deepGroup = select("deep-group", [deep]);
  const bad = [
    udp("udp-over-http", limited),
    http("http-over-http", limited),
    udp("udp-over-mixed", mixed),
    http("http-over-mixed", mixed),
    udp("udp-over-deep", deep),
    http("http-over-deep-group", deepGroup),
  ];
  for (const terminal of bad) {
    const top = select("top", [terminal, capable]);
    const p = make(
      top,
      [limited, capable, deep, terminal],
      [mixed, udpRelay, deepGroup, top],
      reject,
    );
    const result = check(p);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.profiles[0]?.diagnostics.filter((d) => d.code === "TCP_ONLY_EXIT").map((d) => d.path),
      ["routes[0].to", "fallback"],
    );
  }
  for (const via of [capable, udpRelay]) {
    const terminal = http("http-over-udp", via);
    assert.equal(
      check(make(terminal, [limited, capable, terminal], [mixed, udpRelay], reject)).ok,
      true,
    );
  }
  const terminal = http("http-over-http", limited);
  for (const general of [undefined, reject, direct, [reject, direct], [direct, reject]])
    assert.equal(check(make(terminal, [limited, terminal], [], general, true)).ok, true);
});
// @feature docs/feature/profile/library/surge.md#不支持-udp-的出口
test("every general fragment rejects invalid policy values even when a later valid value overrides it", () => {
  for (const invalid of ["reject", "DROP", true, 0, null])
    for (const general of [
      { "udp-policy-not-supported-behaviour": invalid },
      [{ "udp-policy-not-supported-behaviour": invalid }, reject],
      [direct, { "udp-policy-not-supported-behaviour": invalid }, reject],
    ])
      assert.throws(
        () => make(http("http"), [http("unused")], [], general as never),
        (e: unknown) => e instanceof ProfileDefinitionError && e.code === "INVALID_FIELD",
      );
});
