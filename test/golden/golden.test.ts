import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineBuild, runBuild } from "proxylang";
import { scenarios, scenarioProfile, validationValue } from "../fixtures/scenarios.js";
// @feature docs/feature/targets/README.md#编码规则
for (const scenario of scenarios)
  test(`golden ${scenario.id}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "proxylang-golden-"));
    try {
      const p = scenarioProfile(scenario);
      const result = await runBuild(
        defineBuild({ profiles: { fixture: p }, secrets: validationValue }),
        dir,
      );
      assert.equal(result.published, true, JSON.stringify(result));
      const ext =
        scenario.engine === "surge" ? "conf" : scenario.engine === "sing-box" ? "json" : "yaml";
      const actual = await readFile(join(dir, "out", `fixture.${ext}`));
      const expected = await readFile(new URL(`./${scenario.id}/expected.${ext}`, import.meta.url));
      assert.deepEqual(actual, expected);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
