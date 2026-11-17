import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readlink, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineBuild, runBuild, checkBuild, secrets } from "proxylang";
import { scenarios, scenarioProfile, validationValue } from "../fixtures/scenarios.js";
// @feature docs/feature/build/README.md
test("batch validation reads no secrets and rendering caches each referenced secret once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "proxylang-batch-"));
  let reads = 0;
  const profile = scenarioProfile(
    scenarios.find((s) => s.engine === "surge" && s.scene === "groups")!,
  );
  const def = defineBuild({
    profiles: { one: profile, two: profile },
    secrets: (s) => {
      reads++;
      return validationValue(s);
    },
  });
  try {
    assert.equal(checkBuild(def).ok, true);
    assert.equal(reads, 0);
    assert.deepEqual(await readdir(dir), []);
    assert.equal((await runBuild(def, dir)).exitCode, 0);
    assert.equal(reads, 1);
    const previous = await readlink(join(dir, "out"));
    reads = 0;
    const invalid = defineBuild({
      ...def,
      profiles: {
        one: profile,
        two: { ...profile, target: { ...profile.target, version: "0.0.0" } },
      },
    });
    assert.equal((await runBuild(invalid, dir)).published, false);
    assert.equal(reads, 0);
    assert.equal(await readlink(join(dir, "out")), previous);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
// @feature docs/feature/build/library.md
test("configuration rejects callbacks outside its declared envelope", () => {
  assert.throws(() => defineBuild({ profiles: {}, preflight: () => [] } as never));
  for (const outDir of ["", " leading", "trailing ", "\0"])
    assert.throws(() => defineBuild({ profiles: {}, outDir }));
});
// @feature docs/feature/profile/library/README.md#秘密
test("missing or throwing secret sources return fixed errors without values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "proxylang-secret-"));
  const p = scenarioProfile(scenarios.find((s) => s.engine === "surge" && s.scene === "groups")!);
  try {
    for (const source of [
      () => undefined,
      () => {
        throw new Error("TEST_DO_NOT_ECHO");
      },
    ]) {
      const result = await runBuild(
        defineBuild({ profiles: { fixture: p }, secrets: source }),
        dir,
      );
      assert.equal(result.published, false);
      assert.doesNotMatch(JSON.stringify(result), /TEST_DO_NOT_ECHO/);
      assert.deepEqual(await readdir(dir), []);
    }
    const validated = await runBuild(
      defineBuild({
        profiles: { fixture: p },
        secrets: secrets(
          { env: ["TEST_PASSWORD"], validation: { TEST_PASSWORD: "test-valid" } },
          {},
        ),
      }),
      dir,
      { validation: true },
    );
    assert.equal(validated.published, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
