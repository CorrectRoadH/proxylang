import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readlink, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defineBuild,
  defineProfile,
  runBuild,
  checkBuild,
  defineSecrets,
  proxy,
  match,
  defineRoutes,
  outbound,
  ProfileDefinitionError,
} from "proxylang";
const target = { engine: "surge", platform: "macos", version: "6.10.0" } as const;
const make = (password: Parameters<typeof proxy.trojan>[0]["password"]) => {
  const node = proxy.trojan({ id: "edge", server: "192.0.2.10", port: 443, password });
  return defineProfile({ target, proxies: [node], groups: [], routes: [], fallback: node });
};
// @feature docs/feature/profile/library/README.md#秘密
test("secret handles retain collection identity and never carry source values", () => {
  const secrets = defineSecrets({
    TEST_PASSWORD: { value: "TEST_DO_NOT_ECHO", validation: "test-valid" },
  });
  const other = defineSecrets({ TEST_PASSWORD: { value: "test-other" } });
  assert.ok(Object.isFrozen(secrets));
  assert.ok(Object.isFrozen(secrets.TEST_PASSWORD));
  assert.doesNotMatch(JSON.stringify(secrets), /TEST_DO_NOT_ECHO|test-valid/);
  assert.equal(
    checkBuild(defineBuild({ profiles: { fixture: make(secrets.TEST_PASSWORD) }, secrets })).ok,
    true,
  );
  for (const collection of [undefined, other]) {
    const result = checkBuild(
      defineBuild({ profiles: { fixture: make(secrets.TEST_PASSWORD) }, secrets: collection }),
    );
    assert.equal(result.code, "CHECK_FAILED");
    assert.equal(result.profiles[0]!.diagnostics[0]!.code, "SECRET_UNDECLARED");
    assert.doesNotMatch(JSON.stringify(result), /TEST_DO_NOT_ECHO/);
  }
  assert.throws(
    () =>
      proxy.trojan({
        id: "edge",
        server: "192.0.2.10",
        port: 443,
        password: { type: "env", name: "TEST_PASSWORD" } as never,
      }),
    (e: unknown) => e instanceof ProfileDefinitionError && e.code === "INVALID_RESOURCE",
  );
});
// @feature docs/feature/build/library.md
test("build definitions reject unregistered profiles, secret callbacks, invalid keys and raw check inputs", () => {
  for (const input of [
    { profiles: {} },
    {
      profiles: { one: make(defineSecrets({ TEST_PASSWORD: { value: "test" } }).TEST_PASSWORD) },
      secrets: () => "",
    },
    { profiles: { one: {} } },
  ])
    assert.throws(() => defineBuild(input as never));
  const p = make(defineSecrets({ TEST_PASSWORD: { value: "test" } }).TEST_PASSWORD);
  for (const outDir of ["", " leading", "trailing ", "\0"])
    assert.throws(() => defineBuild({ profiles: { one: p }, outDir }));
  assert.throws(() => checkBuild({ profiles: { one: p } } as never));
});
// @feature docs/feature/profile/library/README.md#秘密
test("check reads no environment and a rendering batch reads each handle exactly once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "proxylang-batch-"));
  const previous = process.env;
  let reads = 0;
  process.env = new Proxy(previous, {
    get: (env, key) =>
      key === "TEST_BATCH_PASSWORD" ? (reads++, "test-only") : Reflect.get(env, key),
  });
  const secrets = defineSecrets({
    TEST_PASSWORD: { env: "TEST_BATCH_PASSWORD", validation: "test-valid" },
  });
  const profile = make(secrets.TEST_PASSWORD);
  const def = defineBuild({ outDir: dir, profiles: { one: profile, two: profile }, secrets });
  try {
    assert.equal(checkBuild(def).ok, true);
    assert.equal(reads, 0);
    assert.deepEqual(await readdir(dir), []);
    assert.equal((await runBuild(def)).published, true);
    assert.equal(reads, 1);
    const pointer = await readlink(join(dir, "out"));
    const bad = defineProfile({
      ...profile,
      fallback: proxy.trojan({
        id: "other",
        server: "192.0.2.20",
        port: 443,
        password: secrets.TEST_PASSWORD,
      }),
    });
    const failed = await runBuild(defineBuild({ ...def, profiles: { one: profile, two: bad } }));
    assert.equal(failed.code, "CHECK_FAILED");
    assert.equal(reads, 1);
    assert.equal(await readlink(join(dir, "out")), pointer);
  } finally {
    process.env = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
// @feature docs/feature/profile/library/README.md#秘密
test("validation never falls back to a production value and failure never publishes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "proxylang-validation-"));
  try {
    for (const [source, validation, code] of [
      [{ value: "TEST_DO_NOT_ECHO" }, true, "SECRET_VALIDATION_MISSING"],
      [{ env: "TEST_MISSING_NEVER_SET" }, false, "SECRET_MISSING"],
      [{ value: "" }, false, "SECRET_MISSING"],
    ] as const) {
      const secrets = defineSecrets({ TEST_PASSWORD: source });
      const result = await runBuild(
        defineBuild({ outDir: dir, profiles: { one: make(secrets.TEST_PASSWORD) }, secrets }),
        { validation },
      );
      assert.equal(result.code, code);
      assert.equal(result.secretName, "TEST_PASSWORD");
      assert.equal(result.published, false);
      assert.deepEqual(await readdir(dir), []);
      assert.doesNotMatch(JSON.stringify(result), /TEST_DO_NOT_ECHO/);
    }
    const secrets = defineSecrets({
      TEST_PASSWORD: { env: "TEST_MISSING_NEVER_SET", validation: "test-valid" },
    });
    assert.equal(
      (
        await runBuild(
          defineBuild({ outDir: dir, profiles: { one: make(secrets.TEST_PASSWORD) }, secrets }),
          { validation: true },
        )
      ).published,
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
// @feature docs/feature/profile/library/proxies.md#协议字段
test("cached handles still validate UUID at every use and leave the previous generation active", async () => {
  const dir = await mkdtemp(join(tmpdir(), "proxylang-uuid-"));
  const secrets = defineSecrets({ TEST_PASSWORD: { value: "test-not-a-uuid" } });
  const p = make(secrets.TEST_PASSWORD);
  try {
    assert.equal(
      (await runBuild(defineBuild({ outDir: dir, profiles: { one: p }, secrets }))).published,
      true,
    );
    const pointer = await readlink(join(dir, "out"));
    const vmess = proxy.vmess({
      id: "vmess",
      server: "192.0.2.20",
      port: 443,
      uuid: secrets.TEST_PASSWORD,
    });
    const bad = defineProfile({
      ...p,
      proxies: [...p.proxies, vmess],
      routes: defineRoutes({ when: match.network("tcp"), to: vmess }),
      fallback: outbound.direct,
    });
    const result = await runBuild(defineBuild({ outDir: dir, profiles: { one: bad }, secrets }));
    assert.equal(result.code, "INVALID_UUID_SECRET");
    assert.equal(await readlink(join(dir, "out")), pointer);
    assert.doesNotMatch(JSON.stringify(result), /test-not-a-uuid/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// @feature docs/feature/targets/README.md#资源图
test("cross-Profile endpoint state and output overlaps are reported before rendering", async () => {
  const { singbox } = await import("proxylang");
  const ep = singbox.tailscale({
    id: "mesh",
    hostname: "example-device",
    stateDirectory: "/var/lib/example-mesh",
    acceptRoutes: true,
    bootstrapResolver: "192.0.2.53",
  });
  const profile = defineProfile({
    target: { engine: "sing-box", platform: "linux", version: "1.14.4" },
    proxies: [ep],
    groups: [],
    routes: [],
    fallback: ep,
    singBox: { listener: { port: 16900, resolver: "192.0.2.53" } },
  });
  const shared = checkBuild(defineBuild({ profiles: { one: profile, two: profile } }));
  assert.equal(shared.code, "CHECK_FAILED");
  assert.ok(
    shared.profiles.every((p) => p.diagnostics.some((d) => d.code === "ENDPOINT_STATE_OVERLAP")),
  );
  const overlap = checkBuild(
    defineBuild({ outDir: "/var/lib/example-mesh/generated", profiles: { one: profile } }),
  );
  assert.equal(overlap.outputDirectoryChecked, true);
  assert.ok(overlap.profiles[0]!.diagnostics.some((d) => d.code === "ENDPOINT_STATE_OVERLAP"));
  assert.equal(
    checkBuild(defineBuild({ profiles: { one: profile } })).outputDirectoryChecked,
    false,
  );
});
