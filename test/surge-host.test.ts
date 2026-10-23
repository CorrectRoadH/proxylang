import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  mkdir,
  writeFile,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildSurgeProfilesToDirectory,
  runSurgeBuild,
  defineSurgeBuild,
  surgeProfile,
  surgeMembers,
  compileSurgeProfile,
  proxy,
  secret,
  type SurgeProfileInput,
} from "../src/index.js";
import * as publisher from "../src/surge-publish.js";

const input = (): SurgeProfileInput => ({
  target: { engine: "surge", platform: "macos", version: "6.10.0" },
  nodes: [
    proxy.trojan({
      id: "edge",
      label: "Edge",
      provider: "fixture",
      region: "SG",
      server: "192.0.2.1",
      port: 443,
      password: secret("PASS"),
    }),
  ],
  groups: [{ id: "choice", type: "select", members: [{ ref: "edge" }] }],
  rules: [],
  fallback: { ref: "choice" },
});
async function workspace(t: { onTestFinished(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "proxylang-surge-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

// @use-case docs/feature/target-compilation/use-case/surge-profile.md
test("composition selects shared names without masking unknown explicit mappings; queries preserve order", () => {
  const profile = input();
  const composed = surgeProfile(
    { ...profile, names: { choice: "Explicit" } },
    { choice: "Shared", unused: "Elsewhere" },
  );
  assert.equal(composed.general, profile.general);
  assert.equal(composed.nodes, profile.nodes);
  assert.deepEqual(composed.names, { edge: "Edge", choice: "Explicit" });
  assert.equal(compileSurgeProfile(composed).ok, true);
  assert.equal(
    compileSurgeProfile(surgeProfile({ ...profile, names: { unknown: "Bad" } })).ok,
    false,
  );
  const nodes = [
    ...profile.nodes,
    { ...profile.nodes[0]!, id: "second", region: "HK" },
    { ...profile.nodes[0]!, id: "third" },
  ];
  assert.deepEqual(surgeMembers(nodes, { regions: ["SG"], providers: ["fixture"] }), [
    { ref: "edge" },
    { ref: "third" },
  ]);
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("batch compilation precedes all secret reads; rendering shares one snapshot and preserves old files on error", async (t) => {
  const root = await workspace(t);
  const batch = { first: input(), second: input() };
  let reads = 0;
  const resolver = () => {
    reads++;
    return "fixture-value";
  };
  assert.equal(
    (
      await buildSurgeProfilesToDirectory(
        { ...batch, second: { ...input(), fallback: { ref: "absent" } } },
        root,
        resolver,
      )
    ).code,
    "COMPILATION_FAILED",
  );
  assert.equal(reads, 0);
  assert.deepEqual(await readdir(root), []);
  const built = await buildSurgeProfilesToDirectory(batch, root, resolver);
  assert.equal(built.exitCode, 0);
  assert.equal(reads, 1);
  const old = await readlink(join(root, "out"));
  const before = await readFile(join(root, "out", "first.conf"), "utf8");
  const second = {
    ...input(),
    nodes: [proxy.http({ id: "edge", server: "192.0.2.1", port: 80, password: secret("LATER") })],
  };
  const failed = await buildSurgeProfilesToDirectory({ first: input(), second }, root, (token) => {
    if (token.name === "LATER") throw new Error("must-not-leak");
    return "fixture-value";
  });
  assert.equal(failed.published, false);
  assert.equal(failed.code, "SECRET_RESOLUTION_FAILED");
  assert.ok(!JSON.stringify(failed).includes("must-not-leak"));
  assert.equal(await readlink(join(root, "out")), old);
  assert.equal(await readFile(join(root, "out", "first.conf"), "utf8"), before);
  assert.equal((await readdir(join(root, ".generations"))).length, 1);
  assert.equal(
    (await buildSurgeProfilesToDirectory(batch, "  ", resolver)).code,
    "INVALID_OUTPUT_DIRECTORY",
  );
  assert.equal(
    (await buildSurgeProfilesToDirectory({ "../bad": input() }, root, resolver)).code,
    "INVALID_PROFILE_FILENAMES",
  );
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("public result distinguishes committed cleanup failure and failed legacy recovery", async (t) => {
  const root = await workspace(t);
  const realPublish = publisher.publishProfiles;
  const spy = vi.spyOn(publisher, "publishProfiles");
  t.onTestFinished(() => spy.mockRestore());
  spy.mockImplementation((files, directory) =>
    realPublish(files, directory, {
      rename,
      rm: async () => {
        throw new Error("private cleanup error");
      },
    }),
  );
  const result = await runSurgeBuild(
    { profiles: { first: input() }, resolveSecret: () => "fixture" },
    root,
  );
  assert.equal(result.published, true);
  assert.equal(result.exitCode, 2);
  assert.equal(result.code, "PUBLISHED_CLEANUP_FAILED");
  assert.equal(result.active, join(root, "out"));
  assert.match(await readFile(join(root, "out", "first.conf"), "utf8"), /FINAL/);

  const legacy = await workspace(t);
  await mkdir(join(legacy, "out"));
  await writeFile(join(legacy, "out", "first.conf"), "old");
  let calls = 0;
  spy.mockImplementation((files, directory) =>
    realPublish(files, directory, {
      rename: async (a, b) => {
        if (++calls > 1) throw new Error("private rename error");
        await rename(a, b);
      },
    }),
  );
  const failed = await runSurgeBuild(
    { profiles: { first: input() }, resolveSecret: () => "fixture" },
    legacy,
  );
  assert.equal(failed.published, false);
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.code, "PUBLISH_RECOVERY_REQUIRED");
  const files = await readdir(legacy);
  assert.ok(files.includes(".build-lock"));
  assert.ok(files.some((name) => name.startsWith(".out-")));
  assert.ok(!files.includes("out"));
  const generations = await readdir(join(legacy, ".generations"));
  assert.equal(generations.length, 2);
  assert.equal(
    await readFile(
      join(
        legacy,
        ".generations",
        generations.find((name) => name.startsWith("legacy-"))!,
        "first.conf",
      ),
      "utf8",
    ),
    "old",
  );
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("build captures data before callbacks and resolves secrets only after the complete batch compiles", async (t) => {
  const root = await workspace(t);
  const profiles = { first: input(), second: input() };
  let reads = 0;
  let preflights = 0;
  const definition = defineSurgeBuild({
    profiles,
    preflight: () => {
      preflights++;
      profiles.second = { ...profiles.second, fallback: { ref: "missing" } };
      return ["WARNING_A", "WARNING_B", "WARNING_A"];
    },
    resolveSecret: (_token, context) => {
      reads++;
      assert.equal(context.validation, true);
      return "fixture";
    },
  });
  profiles.first = { ...profiles.first, fallback: { ref: "missing" } };
  const result = await runSurgeBuild(definition, root, { validation: true });
  assert.equal(result.published, true);
  assert.equal(result.profileCount, 2);
  assert.deepEqual(result.warnings, { WARNING_A: 2, WARNING_B: 1 });
  assert.equal(preflights, 1);
  assert.equal(reads, 1);
  reads = 0;
  const failed = await runSurgeBuild(
    {
      profiles,
      resolveSecret: () => {
        reads++;
        return "fixture";
      },
    },
    root,
  );
  assert.equal(failed.code, "COMPILATION_FAILED");
  assert.equal(reads, 0);
  assert.equal(
    (await runSurgeBuild({ profiles }, root, { validation: true })).code,
    "VALIDATION_RESOLVER_REQUIRED",
  );
  let getters = 0;
  const bad = Object.defineProperty({}, "profiles", {
    enumerable: true,
    get() {
      getters++;
      throw Error("private");
    },
  });
  assert.equal((await runSurgeBuild(bad as never, root)).code, "INVALID_BUILD_DEFINITION");
  assert.equal(getters, 0);
  for (const returned of [undefined, null, ["private-token"], Array(1), Array(1001).fill("WARN")]) {
    const invalid = await runSurgeBuild({ profiles, preflight: () => returned as never }, root);
    assert.equal(invalid.code, "INVALID_PREFLIGHT_WARNINGS");
    assert.equal(invalid.profileCount, 2);
    assert.deepEqual(invalid.warnings, {});
  }
  assert.equal(
    (
      await runSurgeBuild(
        {
          profiles,
          preflight: () => {
            throw Error("private");
          },
        },
        root,
      )
    ).code,
    "PREFLIGHT_FAILED",
  );
});
