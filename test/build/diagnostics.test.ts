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
  surge,
  singbox,
  match,
  ruleSet,
  outbound,
  checkBuild,
  explainProfile,
  type Profile,
} from "proxylang";
const surgeTarget = { engine: "surge", platform: "macos", version: "6.11.0" } as const;
const make = (p: Profile, secrets?: ReturnType<typeof defineSecrets>) =>
  checkBuild(defineBuild({ profiles: { one: p }, secrets })).profiles[0]!;
// @feature docs/feature/targets/README.md#诊断
test("retired versions identify the latest stable release for the requested platform", () => {
  for (const [engine, platform, version, latest] of [
    ["surge", "macos", "6.10.0", "6.11.0"],
    ["surge", "ios", "5.21.0", "5.23.0"],
    ["sing-box", "macos", "1.12.0", "1.14.4"],
    ["mihomo", "linux", "1.19.32", "1.19.34"],
    ["stash", "macos", "4.2.1", "5.0.0"],
  ] as const) {
    const result = make(
      defineProfile({
        target: { engine, platform, version } as never,
        proxies: [],
        groups: [],
        routes: [],
        fallback: outbound.direct,
      }),
    );
    assert.equal(result.ok, false);
    const diagnostic = result.diagnostics.find((entry) => entry.code === "TARGET_UNSUPPORTED");
    assert.equal(diagnostic?.path, "target.version");
    assert.ok(diagnostic?.message.includes(`最新稳定版 ${latest}`));
  }
});
// @feature docs/feature/profile/library/README.md#秘密
test("undeclared handles report every use at its own resource, managed query and array path", () => {
  const declared = defineSecrets({ TEST_VALID: { value: "test-only", validation: "test-only" } });
  const other = defineSecrets({ TEST_SECRET: { value: "test-only", validation: "test-only" } });
  const relay = proxy.trojan({
    id: "relay",
    server: "192.0.2.1",
    port: 443,
    password: other.TEST_SECRET,
  });
  const exit = proxy.trojan({
    id: "exit",
    server: "192.0.2.2",
    port: 443,
    password: declared.TEST_VALID,
    via: relay,
  });
  const second = proxy.http({
    id: "second",
    server: "192.0.2.3",
    port: 8080,
    username: other.TEST_SECRET,
    password: other.TEST_SECRET,
  });
  const tunnel = surge.wireguard({
    id: "wg",
    sectionName: "example",
    privateKey: other.TEST_SECRET,
    selfIp: "192.0.2.4",
    peers: [
      {
        publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        endpoint: "192.0.2.5:51820",
        allowedIps: ["192.0.2.0/24"],
        presharedKey: other.TEST_SECRET,
      },
    ],
  });
  const profile = defineProfile({
    target: surgeTarget,
    proxies: [exit, relay, second, tunnel],
    groups: [],
    routes: [],
    fallback: outbound.direct,
    surge: {
      managed: {
        url: "https://config.example.com/profile",
        query: { first: other.TEST_SECRET, second: other.TEST_SECRET },
        intervalSeconds: 3600,
        strict: true,
      },
    },
  });
  const result = make(profile, declared);
  const diagnostics = result.diagnostics.filter((d) => d.code === "SECRET_UNDECLARED");
  assert.deepEqual(
    new Set(diagnostics.map((d) => d.path)),
    new Set([
      "proxies.relay.password",
      "proxies.second.username",
      "proxies.second.password",
      "proxies.wg.privateKey",
      "proxies.wg.peers[0].presharedKey",
      "surge.managed.query.first",
      "surge.managed.query.second",
    ]),
  );
  const relayError = diagnostics.find((d) => d.path === "proxies.relay.password")!;
  const secondError = diagnostics.find((d) => d.path === "proxies.second.password")!;
  assert.ok(relayError.origin);
  assert.ok(secondError.origin);
  assert.notEqual(relayError.origin.line, secondError.origin.line);
});
// @feature docs/feature/targets/README.md#诊断
test("name and group errors do not suppress protocol and platform checks or reset selections", () => {
  const secrets = defineSecrets({
    TEST_UUID: {
      value: "11111111-2222-4333-8444-555555555555",
      validation: "11111111-2222-4333-8444-555555555555",
    },
  });
  const node = proxy.vless({
    id: "edge",
    name: "bad,name",
    server: "192.0.2.1",
    port: 443,
    uuid: secrets.TEST_UUID,
  });
  const unsupported = defineProxyGroup({
    id: "test",
    algorithm: group.urltest({ url: "https://test.example.com/probe" }),
    members: [node],
  });
  const p = defineProfile({
    target: { engine: "surge", platform: "ios", version: "5.23.0" },
    proxies: [node],
    groups: [unsupported],
    routes: defineRoutes({ when: match.processName("Example"), to: node }),
    fallback: outbound.direct,
  });
  const result = make(p, secrets);
  for (const [code, path] of [
    ["NAME_UNSAFE", "proxies.edge.name"],
    ["GROUP_ALGORITHM_UNSUPPORTED", "groups.test.algorithm"],
    ["PROTOCOL_UNSUPPORTED", "proxies.edge"],
    ["CONDITION_UNSUPPORTED", "routes[0].when"],
  ])
    assert.ok(
      result.diagnostics.some((d) => d.code === code && d.path === path),
      JSON.stringify(result),
    );
  assert.ok(result.selections.some((s) => s.kind === "name" && s.resource === "edge"));
  const explanation = explainProfile(p, {});
  assert.ok(!explanation.ok);
  assert.ok(explanation.diagnostics.some((d) => d.code === "PROTOCOL_UNSUPPORTED"));
});
// @feature docs/feature/targets/README.md#诊断
test("same-code errors at independent paths survive diagnostic merging", () => {
  const ep = singbox.tailscale({
    id: "mesh",
    hostname: "example",
    stateDirectory: "/var/lib/example-diagnostic-mesh",
    acceptRoutes: true,
    bootstrapResolver: "192.0.2.53",
  });
  const g1 = defineProxyGroup({ id: "first", algorithm: group.select(), members: [ep] });
  const g2 = defineProxyGroup({
    id: "second",
    algorithm: group.select(),
    members: [ep],
  });
  const p = defineProfile({
    target: { engine: "sing-box", platform: "linux", version: "1.14.4" },
    singBox: { mode: "standalone", listener: { port: 1080, resolver: "192.0.2.53" } },
    proxies: [ep],
    groups: [g1, g2],
    routes: [],
    fallback: outbound.direct,
  });
  const result = make(p);
  assert.ok(
    result.diagnostics.some(
      (d) => d.code === "MEMBER_TYPE_UNSUPPORTED" && d.path === "groups.first.members[0]",
    ),
  );
  assert.ok(
    result.diagnostics.some(
      (d) => d.code === "MEMBER_TYPE_UNSUPPORTED" && d.path === "groups.second.members[0]",
    ),
  );
  assert.equal(
    new Set(result.diagnostics.map((d) => JSON.stringify([d.code, d.path]))).size,
    result.diagnostics.length,
  );
});
// @feature docs/feature/targets/README.md#诊断
test("every unsupported Surge exit and condition is located without hiding later target checks", () => {
  const targets = [
    { engine: "sing-box", platform: "linux", version: "1.14.4" },
    { engine: "mihomo", platform: "linux", version: "1.19.34" },
    { engine: "stash", platform: "macos", version: "5.0.0" },
  ] as const;
  for (const target of targets) {
    const g = defineProxyGroup({
      id: "choice",
      algorithm: group.select(),
      members: [outbound.rejectNoDrop],
    });
    const common = {
      proxies: [],
      groups: [g],
      routes: [
        defineRoutes({
          when: [
            surge.ruleSets.lan,
            surge.match.ipAsn(64512),
            surge.match.ipCidr6("2001:db8::/32"),
            surge.match.macAddress("02:ab:00:00:00:01"),
            match.sourcePort(2000),
          ],
          to: outbound.rejectDrop,
        }),
      ],
      fallback: outbound.rejectTinyGif,
      cases: [{ name: "unsupported expectation", request: {}, expect: outbound.rejectDrop }],
    };
    const p =
      target.engine === "sing-box"
        ? defineProfile({ ...common, target, singBox: { mode: "fragment" } })
        : target.engine === "mihomo"
          ? defineProfile({ ...common, target, mihomo: { mode: "fragment" } })
          : defineProfile({ ...common, target });
    const checked = checkBuild(defineBuild({ profiles: { one: p } }));
    const result = checked.profiles[0]!;
    assert.equal(checked.code, "CHECK_FAILED");
    assert.equal(checked.cases[0]?.outcome, "skipped");
    assert.ok(!result.ok);
    assert.ok(
      result.diagnostics.every((d) => d.path !== "$"),
      JSON.stringify(result),
    );
    for (const path of [
      "groups.choice.members[0]",
      "routes[0].to",
      "routes[1].to",
      "routes[2].to",
      "routes[3].to",
      "routes[4].to",
      "fallback",
      "cases[0].expect",
    ])
      assert.ok(
        result.diagnostics.some((d) => d.code === "EXIT_UNSUPPORTED" && d.path === path),
        JSON.stringify(result),
      );
    for (let i = 0; i < 4; i++)
      assert.ok(
        result.diagnostics.some(
          (d) =>
            d.code ===
              (i === 0 && target.engine === "stash"
                ? "RULESET_UNSUPPORTED"
                : "CONDITION_UNSUPPORTED") && d.path === `routes[${i}].when`,
        ),
        JSON.stringify(result),
      );
    if (target.engine === "stash")
      assert.ok(
        result.diagnostics.some(
          (d) => d.code === "CONDITION_UNSUPPORTED" && d.path === "routes[4].when",
        ),
      );
    assert.ok(result.selections.some((s) => s.kind === "name" && s.resource === "choice"));
  }
});
// @feature docs/feature/targets/README.md#诊断
test("missing rule-set sources and cross-engine tunnels do not suppress later condition errors", () => {
  const tunnel = surge.tailscale({
    id: "mesh",
    sectionName: "example",
    authKey: defineSecrets({ TEST_AUTH: { value: "test-only", validation: "test-only" } })
      .TEST_AUTH,
    hostname: "mesh.example",
  });
  const external = ruleSet({ id: "missing", surge: { url: "https://rules.example.com/list" } });
  const result = make(
    defineProfile({
      target: { engine: "stash", platform: "macos", version: "5.0.0" },
      proxies: [tunnel],
      groups: [],
      routes: defineRoutes({ when: [external, match.sourcePort(2000)], to: outbound.direct }),
      fallback: outbound.direct,
    }),
  );
  for (const code of ["TUNNEL_UNSUPPORTED", "RULESET_UNSUPPORTED", "CONDITION_UNSUPPORTED"])
    assert.ok(
      result.diagnostics.some((d) => d.code === code),
      JSON.stringify(result),
    );
  const missing = make(
    defineProfile({
      target: { engine: "sing-box", platform: "linux", version: "1.14.4" },
      singBox: { mode: "fragment" },
      proxies: [],
      groups: [],
      routes: defineRoutes({
        when: [external, match.all(match.ipCidr("192.0.2.0/24"), match.network("tcp"))],
        to: outbound.direct,
      }),
      fallback: outbound.direct,
    }),
  );
  for (const code of ["RULESET_SOURCE_MISSING", "RESOLVE_NESTED"])
    assert.ok(
      missing.diagnostics.some((d) => d.code === code),
      JSON.stringify(missing),
    );
});
