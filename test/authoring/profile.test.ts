import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import * as sdk from "proxylang";
import {
  defineBuild,
  defineProfile,
  defineRoutes,
  defineProxyGroup,
  checkBuild,
  proxy,
  group,
  surge,
  match,
  outbound,
  ProfileDefinitionError,
} from "proxylang";
import { fixtureSecrets } from "../fixtures/scenarios.js";
const edge = (id = "edge") =>
  proxy.trojan({ id, server: "192.0.2.10", port: 443, password: fixtureSecrets.TEST_PASSWORD });
const target = { engine: "surge", platform: "macos", version: "6.11.0" } as const;
function fixture() {
  const node = edge();
  return {
    target,
    proxies: [node],
    groups: [],
    routes: defineRoutes({ when: match.domain("example.com"), to: node }),
    fallback: node,
  };
}
const check = (input: Parameters<typeof defineProfile>[0]) =>
  checkBuild(defineBuild({ profiles: { fixture: defineProfile(input) }, secrets: fixtureSecrets }));
const codes = (result: ReturnType<typeof checkBuild>) =>
  result.profiles.flatMap((p) => p.diagnostics.map((d) => d.code));
const throws = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof ProfileDefinitionError && e.code === code);
// @feature docs/feature/profile/library/README.md
test("public exports contain only the documented Profile API", () => {
  for (const name of [
    "compile",
    "render",
    "explain",
    "targetCatalog",
    "policy",
    "strategy",
    "defineRoute",
    "secret",
    "secrets",
    "mihomo",
    "compileProfile",
  ])
    assert.equal(name in sdk, false, name);
  assert.deepEqual(Object.keys(surge.match).sort(), ["ipAsn", "ipCidr6", "macAddress"]);
  assert.deepEqual(Object.keys(surge.ruleSets), ["lan", "system"]);
});
// @feature docs/feature/profile/library/README.md#输入快照与预算
test("snapshots copy containers, preserve SDK identity, flatten and deduplicate resources only", () => {
  const input = fixture();
  const node = input.proxies[0]!;
  const profile = defineProfile({
    ...input,
    proxies: [[node], node],
    routes: [input.routes, input.routes],
  });
  input.proxies.length = 0;
  assert.equal(profile.proxies[0], node);
  assert.equal(profile.proxies.length, 1);
  assert.equal(profile.routes.length, 2);
  assert.equal(profile.routes[0]!.to, node);
  assert.equal(profile.fallback, node);
  assert.ok(Object.isFrozen(profile.routes));
  assert.ok(Object.isFrozen(node));
  assert.equal(
    checkBuild(defineBuild({ profiles: { one: profile, two: profile }, secrets: fixtureSecrets }))
      .ok,
    true,
  );
});
// @feature docs/feature/profile/library/README.md#错误
test("definitions reject accessors, cycles, expanded DAGs, metadata and forged resources", () => {
  let reads = 0;
  throws(
    () =>
      defineProfile({
        ...fixture(),
        get surge() {
          reads++;
          return {};
        },
      }),
    "INVALID_PROFILE_DEFINITION",
  );
  assert.equal(reads, 0);
  const cycle: unknown[] = [];
  cycle.push(cycle);
  throws(
    () => defineProfile({ ...fixture(), routes: cycle as never }),
    "INVALID_PROFILE_DEFINITION",
  );
  let dag: unknown[] = [];
  for (let i = 0; i < 20; i++) dag = [dag, dag];
  throws(() => defineProfile({ ...fixture(), routes: dag as never }), "INVALID_PROFILE_DEFINITION");
  throws(() => defineProfile({ ...fixture(), fallback: { ...edge() } }), "INVALID_RESOURCE");
  throws(() => defineProfile({ ...fixture(), proxies: [{ ...edge() }] }), "INVALID_RESOURCE");
  throws(
    () => defineRoutes({ when: match.domain("example.com"), to: "edge" as never }),
    "INVALID_RESOURCE",
  );
  throws(() => proxy.trojan({ ...edge(), region: "TEST" } as never), "UNKNOWN_FIELD");
  throws(
    () => defineProfile({ ...fixture(), singBox: {} } as never),
    "PROFILE_EXTENSION_UNSUPPORTED",
  );
  throws(
    () => defineProxyGroup({ id: "empty", algorithm: group.select(), members: [] }),
    "EMPTY_FRAGMENT",
  );
  throws(() => match.all([]), "EMPTY_FRAGMENT");
});
// @feature docs/feature/targets/README.md#诊断
test("check reports all reference and id errors in every Profile with author origins", () => {
  const node = edge();
  const duplicate = edge();
  const unlisted = edge("other");
  const p = defineProfile({
    target,
    proxies: [node, duplicate],
    groups: [],
    routes: defineRoutes({ when: match.domain("example.com"), to: unlisted }),
    fallback: unlisted,
  });
  const result = checkBuild(defineBuild({ profiles: { one: p, two: p }, secrets: fixtureSecrets }));
  assert.equal(result.code, "CHECK_FAILED");
  for (const p of result.profiles) {
    assert.ok(p.diagnostics.some((d) => d.code === "DUPLICATE_ID"));
    assert.equal(p.diagnostics.filter((d) => d.code === "UNLISTED_EXIT").length, 2);
    for (const d of p.diagnostics) {
      assert.equal(d.profile, p.key);
      assert.ok(d.origin?.file.endsWith("profile.test.ts"));
      assert.ok(d.origin!.line > 0);
    }
  }
});
// @feature docs/feature/profile/library/proxies.md#builder
test("builder forks keep protocol and referenced objects without mutating the base", () => {
  const relay = edge("relay");
  const base = edge();
  const builder = proxy.builder(base);
  const a = builder.via(relay).name("Named").build();
  const b = builder.name("Other").build();
  assert.notEqual(a, base);
  assert.equal(a.password, base.password);
  assert.equal(a.via, relay);
  assert.equal(b.via, undefined);
  assert.equal(base.name, undefined);
  throws(() => builder.via(outbound.direct as never), "INVALID_RESOURCE");
  throws(() => proxy.builder({ ...base }), "INVALID_RESOURCE");
  throws(
    () => defineProfile({ ...fixture(), proxies: [builder as never] }),
    "INVALID_PROFILE_DEFINITION",
  );
});
// @feature docs/feature/profile/library/conditions.md#通用条件
for (const method of ["domain", "domainSuffix", "ipCidr", "sourceIp", "processName"] as const)
  test(`${method} supports empty and ordered immutable batches`, () => {
    const values =
      method === "ipCidr"
        ? ["192.0.2.0/24", "2001:db8::/32"]
        : method === "sourceIp"
          ? ["192.0.2.1", "192.0.2.2"]
          : ["one.example", "two.example"];
    const construct = match[method] as (values: readonly string[]) => { value: string }[];
    const conditions = construct(values);
    assert.deepEqual(
      conditions.map((c) => c.value),
      values,
    );
    assert.deepEqual(construct([]), []);
    assert.ok(Object.isFrozen(conditions));
    assert.ok(Object.isFrozen(conditions[0]));
    values[0] = "changed";
    assert.notEqual(conditions[0]!.value, "changed");
  });
// @feature docs/feature/targets/README.md#原生名字
test("name conflicts, builtin collisions and unsafe names fail on every engine", () => {
  for (const t of [
    target,
    { engine: "sing-box", platform: "linux", version: "1.14.4" },
    { engine: "mihomo", platform: "linux", version: "1.19.34" },
    { engine: "stash", platform: "macos", version: "5.0.0" },
  ] as const) {
    const make = (name: string) => proxy.trojan({ ...edge(), name });
    const base = {
      target: t,
      proxies: [],
      groups: [],
      routes: [],
      fallback: outbound.direct,
      ...(t.engine === "sing-box" ? { singBox: { mode: "fragment" } } : {}),
    };
    for (const name of ["bad,name", "bad\nname", " leading", "pl-reserved"])
      assert.ok(codes(check({ ...base, proxies: [make(name)] } as never)).includes("NAME_UNSAFE"));
    assert.ok(
      codes(check({ ...base, proxies: [make("DIRECT")] } as never)).includes(
        "DUPLICATE_NATIVE_NAME",
      ),
    );
    const a = make("Same"),
      b = proxy.trojan({ ...edge("other"), name: "Same" });
    assert.ok(
      codes(check({ ...base, proxies: [a, b] } as never)).includes("DUPLICATE_NATIVE_NAME"),
    );
  }
});
// @feature docs/feature/profile/library/README.md#分组算法
test("auto selections expose concrete algorithms and reject Stash", () => {
  const n = edge();
  const automatic = defineProxyGroup({ id: "automatic", algorithm: group.auto(), members: n });
  for (const [t, expected] of [
    [target, "surge-smart"],
    [{ engine: "sing-box", platform: "linux", version: "1.14.4" }, "urltest"],
    [{ engine: "mihomo", platform: "linux", version: "1.19.34" }, "urltest"],
    [{ engine: "stash", platform: "macos", version: "5.0.0" }, null],
  ] as const) {
    const result = check({
      target: t,
      proxies: [n],
      groups: [automatic],
      routes: [],
      fallback: automatic,
      ...(t.engine === "sing-box" ? { singBox: { mode: "fragment" } } : {}),
    } as never);
    assert.equal(result.ok, expected !== null);
    if (expected)
      assert.ok(
        result.profiles[0]!.selections.some(
          (s) => s.kind === "algorithm" && s.algorithm === expected,
        ),
      );
    else assert.ok(codes(result).includes("GROUP_ALGORITHM_UNSUPPORTED"));
  }
});

// @feature docs/feature/routing-cases/library.md#routecase
test("case expect preserves registered object identity and reports unlisted objects", () => {
  const input = fixture();
  const expected = input.proxies[0]!;
  const profile = defineProfile({
    ...input,
    cases: [[{ name: "example", request: { domain: "example.com" }, expect: expected }]],
  });
  assert.equal(profile.cases![0]!.expect, expected);
  assert.equal(check(profile).ok, true);
  const unlisted = edge("other");
  const failed = check({ ...input, cases: [{ name: "example", request: {}, expect: unlisted }] });
  assert.ok(
    failed.profiles[0]!.diagnostics.some(
      (d) => d.code === "UNLISTED_EXIT" && d.path === "cases[0].expect",
    ),
  );
  throws(
    () =>
      defineProfile({
        ...input,
        cases: [{ name: "example", request: {}, expect: "edge" as never }],
      }),
    "INVALID_RESOURCE",
  );
});

// @feature docs/feature/profile/library/surge.md#分组测试参数
test("select availability tests are a strict Surge group branch, checked against the target and concrete algorithm", () => {
  const n = edge();
  const options = {
    url: "https://test.example.com/probe",
    intervalSeconds: 300,
    timeoutSeconds: 10,
  };
  const tested = defineProxyGroup({
    id: "tested",
    algorithm: group.select(),
    members: [n],
    surge: options,
  });
  const base = { proxies: [n], groups: [tested], routes: [], fallback: n };
  assert.equal(check({ ...base, target }).ok, true);
  for (const t of [
    { engine: "sing-box", platform: "linux", version: "1.14.4" },
    { engine: "mihomo", platform: "linux", version: "1.19.34" },
    { engine: "stash", platform: "macos", version: "5.0.0" },
  ] as const) {
    const result = check({
      ...base,
      target: t,
      ...(t.engine === "sing-box" ? { singBox: { mode: "fragment" } } : {}),
    } as never);
    assert.ok(codes(result).includes("GROUP_OPTION_UNSUPPORTED"));
  }
  for (const algorithm of [surge.smart(), group.auto()])
    assert.ok(
      codes(
        check({
          ...base,
          target,
          groups: [
            defineProxyGroup({ id: "smart-tested", algorithm, members: [n], surge: options }),
          ],
        }),
      ).includes("GROUP_OPTION_UNSUPPORTED"),
    );
  for (const patch of [
    { intervalSeconds: 0 },
    { timeoutSeconds: 3601 },
    { intervalSeconds: 2147483648 },
    { url: "ftp://test.example.com/" },
    { unexpected: true },
  ])
    assert.throws(() =>
      defineProxyGroup({
        id: "invalid",
        algorithm: group.select(),
        members: [n],
        surge: { ...options, ...patch },
      }),
    );
  throws(
    () =>
      defineProxyGroup({
        id: "flat",
        algorithm: group.select(),
        members: [n],
        url: options.url,
      } as never),
    "UNKNOWN_FIELD",
  );
});

// @feature docs/feature/profile/library/README.md#资源与-profile
test("all flattened Profile lists are readonly arrays and SDK-created elements retain identity", async () => {
  const { dnsRule } = await import("proxylang");
  const input = fixture();
  const rule = dnsRule("example.com", "192.0.2.53");
  const profile = defineProfile({
    ...input,
    dns: [[rule]],
    cases: [[{ name: "example", request: {}, expect: input.proxies[0]! }]],
  });
  assert.equal(profile.dns[0], rule);
  assert.equal(profile.routes[0], input.routes[0]);
  for (const array of [profile.proxies, profile.groups, profile.routes, profile.dns, profile.cases])
    assert.ok(Array.isArray(array) && Object.isFrozen(array));
  const reused = defineProfile({ ...input, dns: profile.dns, cases: profile.cases });
  assert.equal(reused.cases[0], profile.cases[0]);
  const empty = defineProfile(input);
  assert.deepEqual(empty.dns, []);
  assert.deepEqual(empty.cases, []);
});
