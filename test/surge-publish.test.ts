// @concord-file
// @concord-implements docs/feature/artifact-publication/use-case/publish-generation.md
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishProfiles } from "../src/surge-publish.js";
const batch = (value: string) =>
  new Map(
    ["iphone-16-pro", "iphone-17-pro", "m1-pro-macbook", "m4mac"].map((id) => [
      `${id}.conf`,
      value,
    ]),
  );
async function workspace(t: { onTestFinished(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "proxy-publish-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function contents(root: string, expected: string) {
  for (const file of batch("").keys())
    assert.equal(await readFile(join(root, "out", file), "utf8"), expected);
}
// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("complete generations publish through one pointer, preserve history and restrictive permissions", async (t) => {
  const root = await workspace(t);
  await publishProfiles(batch("old"), root);
  const old = await readlink(join(root, "out"));
  await publishProfiles(batch("new"), root);
  await contents(root, "new");
  for (const file of batch("").keys()) {
    assert.equal(await readFile(join(root, old, file), "utf8"), "old");
    assert.equal((await stat(join(root, "out", file))).mode & 0o777, 0o600);
  }
  assert.equal((await stat(join(root, await readlink(join(root, "out"))))).mode & 0o777, 0o700);
  assert.deepEqual((await readdir(root)).sort(), [".generations", "out"]);
});
// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("pointer I/O failure retains the entire old batch and removes only new staging", async (t) => {
  const root = await workspace(t);
  await publishProfiles(batch("old"), root);
  const old = await readlink(join(root, "out"));
  await assert.rejects(
    publishProfiles(batch("new"), root, {
      rename: async () => {
        throw new Error("injected");
      },
    }),
    /PROFILE_PUBLISH_FAILED/,
  );
  assert.equal(await readlink(join(root, "out")), old);
  await contents(root, "old");
  assert.equal((await readdir(join(root, ".generations"))).length, 1);
  assert.deepEqual((await readdir(root)).sort(), [".generations", "out"]);
});
// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("first migration restores the complete legacy directory when pointer rename fails", async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, "out"));
  for (const [file, value] of batch("old")) await writeFile(join(root, "out", file), value);
  let calls = 0;
  await assert.rejects(
    publishProfiles(batch("new"), root, {
      rename: async (a, b) => {
        if (++calls === 2) throw new Error("injected");
        await rename(a, b);
      },
    }),
    /PROFILE_PUBLISH_FAILED/,
  );
  await contents(root, "old");
  assert.equal(calls, 3);
  assert.deepEqual(await readdir(join(root, ".generations")), []);
  await publishProfiles(batch("new"), root);
  await contents(root, "new");
  assert.equal((await readdir(join(root, ".generations"))).length, 2);
});
// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("failed legacy rollback preserves recovery evidence and lock", async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, "out"));
  await writeFile(join(root, "out", "m4mac.conf"), "old");
  let calls = 0;
  await assert.rejects(
    publishProfiles(batch("new"), root, {
      rename: async (a, b) => {
        if (++calls > 1) throw new Error("injected");
        await rename(a, b);
      },
    }),
    /PUBLISH_RECOVERY_REQUIRED/,
  );
  const generations = await readdir(join(root, ".generations"));
  assert.equal(generations.length, 2);
  assert.equal(
    await readFile(
      join(
        root,
        ".generations",
        generations.find((n) => n.startsWith("legacy-"))!,
        "m4mac.conf",
      ),
      "utf8",
    ),
    "old",
  );
  assert.ok((await readdir(root)).includes(".build-lock"));
});
// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("reject unmanaged pointers, path traversal and simultaneous build lock", async (t) => {
  const root = await workspace(t);
  await symlink(tmpdir(), join(root, "out"));
  await assert.rejects(publishProfiles(batch("new"), root), /UNMANAGED_OUTPUT_LINK/);
  await assert.rejects(
    publishProfiles(new Map([["../escaped", "secret"]]), root),
    /INVALID_PROFILE_FILENAMES/,
  );
  await rm(join(root, "out"));
  await mkdir(join(root, ".build-lock"));
  await assert.rejects(publishProfiles(batch("new"), root), /OUTPUT_LOCKED/);
  assert.ok((await readdir(root)).includes(".build-lock"));
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("failure moving legacy output leaves every existing file untouched", async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, "out"));
  for (const [file, value] of batch("old")) await writeFile(join(root, "out", file), value);
  await assert.rejects(
    publishProfiles(batch("new"), root, {
      rename: async () => {
        throw new Error("injected");
      },
    }),
    /PROFILE_PUBLISH_FAILED/,
  );
  await contents(root, "old");
  assert.deepEqual(await readdir(join(root, ".generations")), []);
  assert.deepEqual((await readdir(root)).sort(), [".generations", "out"]);
});
