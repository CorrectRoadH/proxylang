import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readlink, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  secrets,
  secret,
  defineBuild,
  checkBuild,
  runBuild,
  outbound,
  proxy,
  type SecretsInput,
} from "../src/index.js";

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("secret declarations snapshot data and read only allowed own environment values", () => {
  const input = { values: { FIXED: "fixed" }, env: ["TOKEN"], validation: { TOKEN: "validation" } };
  let reads = 0;
  const raw = Object.assign(Object.create({ INHERITED: "hidden" }), { TOKEN: "production" });
  const env = new Proxy(raw, {
    getOwnPropertyDescriptor(target, key) {
      reads++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const read = secrets(input, env);
  assert.equal(reads, 0);
  input.values.FIXED = "changed";
  input.env.push("UNDECLARED");
  input.validation.TOKEN = "changed";
  assert.equal(read(secret("FIXED")), "fixed");
  assert.equal(read(secret("UNDECLARED")), undefined);
  assert.equal(read(secret("TOKEN"), { validation: true }), "validation");
  assert.equal(reads, 0);
  assert.equal(read(secret("TOKEN")), "production");
  raw.TOKEN = "next";
  assert.equal(read(secret("TOKEN")), "next");
  assert.equal(reads, 2);
  assert.equal(secrets({ env: ["INHERITED"] }, env)(secret("INHERITED")), undefined);
  let gets = 0;
  Object.defineProperty(raw, "ACCESSOR", {
    get() {
      gets++;
      return "never";
    },
  });
  assert.throws(
    () => secrets({ env: ["ACCESSOR"] }, env)(secret("ACCESSOR")),
    /SECRET_RESOLUTION_FAILED/,
  );
  assert.equal(gets, 0);
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("secret declarations reject invalid data with bounded, redacted errors", () => {
  const invalid: unknown[] = [
    { values: { BAD: "" } },
    { values: { bad: "must-not-leak" } },
    { values: { A: "x".repeat(65537) } },
    {
      values: Object.fromEntries(
        Array.from({ length: 17 }, (_, i) => [`A${i}`, "x".repeat(65536)]),
      ),
    },
    { values: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`A${i}`, "x"])) },
    { env: ["A", "A"] },
    { env: Object.assign([], { length: 1 }) },
    { values: { A: "secret" }, env: ["A"] },
    { validation: { A: "unknown" } },
    { values: null },
    { env: null },
    { validation: [] },
    { unknown: "must-not-leak" },
    { values: { A: undefined } },
    { env: ["bad"] },
  ];
  let gets = 0;
  invalid.push({
    get values() {
      gets++;
      return { A: "secret" };
    },
  });
  const cycle: Record<string, unknown> = {};
  cycle.values = cycle;
  invalid.push(cycle);
  for (const value of invalid)
    assert.throws(
      () => secrets(value as SecretsInput),
      (error) => error instanceof Error && error.message === "INVALID_SECRETS_DEFINITION",
    );
  assert.equal(gets, 0);
  const read = secrets({ env: ["ABSENT"], validation: { ABSENT: "validation" } }, {});
  assert.equal(read(secret("ABSENT")), undefined);
  assert.equal(read(secret("ABSENT"), { validation: true }), "validation");
});

// @use-case docs/feature/artifact-publication/use-case/publish-generation.md
test("real builds cache per batch, refresh between builds, keep check pure and preserve output on missing secrets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "secret-inputs-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let reads = 0;
  const raw: Record<string, string> = { PASS: "first" };
  const environment = new Proxy(raw, {
    getOwnPropertyDescriptor(target, key) {
      reads++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const profile = {
    target: { engine: "surge", platform: "macos", version: "6.10.0" } as const,
    proxies: [
      proxy.http({ id: "edge", server: "192.0.2.1", port: 8080, password: secret("PASS") }),
    ],
    groups: [],
    routes: [],
    fallback: outbound.direct,
  };
  const definition = defineBuild({
    profiles: { one: profile, two: profile },
    secrets: secrets({ env: ["PASS", "UNUSED"], validation: { PASS: "test-value" } }, environment),
  });
  assert.equal(checkBuild(definition).ok, true);
  assert.equal(reads, 0);
  assert.deepEqual(await readdir(root), []);
  assert.equal((await runBuild(definition, root, { validation: true })).published, true);
  assert.equal(reads, 0);
  assert.match(await readFile(join(root, "out/one.conf"), "utf8"), /test-value/);
  assert.equal((await runBuild(definition, root)).published, true);
  assert.equal(reads, 1);
  raw.PASS = "second";
  assert.equal((await runBuild(definition, root)).published, true);
  assert.equal(reads, 2);
  assert.match(await readFile(join(root, "out/two.conf"), "utf8"), /second/);
  const active = await readlink(join(root, "out"));
  delete raw.PASS;
  const missing = await runBuild(definition, root);
  assert.equal(missing.code, "SECRET_RESOLUTION_FAILED");
  assert.equal(missing.secretName, "PASS");
  assert.equal(missing.secretReason, "MISSING");
  assert.equal(reads, 3);
  const resolverFailed = await runBuild(
    {
      ...definition,
      secrets: () => {
        throw Object.assign(new Error("private-value"), {
          secretName: "PRIVATE_VALUE",
          secretReason: "MISSING",
        });
      },
    },
    root,
  );
  assert.equal(resolverFailed.secretName, "PASS");
  assert.equal(resolverFailed.secretReason, "RESOLUTION_FAILED");
  assert.doesNotMatch(JSON.stringify(resolverFailed), /private-value|PRIVATE_VALUE/);
  assert.equal(await readlink(join(root, "out")), active);
  assert.doesNotMatch(JSON.stringify(checkBuild(definition)), /first|second|test-value/);
  assert.throws(
    () => defineBuild({ profiles: { one: profile }, resolveSecret: () => "old" } as never),
    /INVALID_BUILD_DEFINITION/,
  );
});
