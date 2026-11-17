import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineBuild, runBuild } from "proxylang";
import { scenarios, scenarioProfile, validationValue } from "../test/fixtures/scenarios.js";
const root = await mkdtemp(join(tmpdir(), "proxylang-golden-"));
try {
  for (let offset = 0; offset < scenarios.length; offset += 16) {
    const batch = scenarios.slice(offset, offset + 16);
    const definition = defineBuild({
      profiles: Object.fromEntries(batch.map((s, i) => [`golden-${i}`, scenarioProfile(s)])),
      secrets: validationValue,
    });
    const result = await runBuild(definition, root);
    if (!result.published) throw new Error(`Golden batch ${offset}: ${JSON.stringify(result)}`);
    for (const [i, s] of batch.entries()) {
      const ext = s.engine === "surge" ? "conf" : s.engine === "sing-box" ? "json" : "yaml";
      await writeFile(
        new URL(`../test/golden/${s.id}/expected.${ext}`, import.meta.url),
        await readFile(join(root, "out", `golden-${i}.${ext}`)),
      );
    }
  }
  console.log(`Updated ${scenarios.length} golden files`);
} finally {
  await rm(root, { recursive: true, force: true });
}
