import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";

const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));
const integrity = `sha512-${createHash("sha512")
  .update(readFileSync(`.cache/release/${name}-${version}.tgz`))
  .digest("base64")}`;
let verified = false;
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await fetch(`https://registry.npmjs.org/${name}/${version}`, {
    signal: AbortSignal.timeout(30000),
    headers: { "Cache-Control": "no-cache" },
  });
  if (response.ok) {
    const published = await response.json();
    assert.equal(published.version, version);
    assert.equal(published.dist.integrity, integrity);
    verified = true;
    break;
  }
  assert.ok(response.status === 404 || response.status >= 500, `Registry HTTP ${response.status}`);
  console.log(`Waiting for ${name}@${version} to become public (${attempt + 1}/12)`);
  if (attempt < 11) await setTimeout(15000);
}
assert.ok(verified, "Version is not public yet; check registry state before retrying publication");
console.log(`Verified public ${name}@${version} with matching SHA512`);
