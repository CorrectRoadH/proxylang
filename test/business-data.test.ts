import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  compile,
  compileProxyNodes,
  compileProfile,
  compileSurgeProfile,
  defineProxyGroup,
  group,
  outbound,
  renderSurgeProfile,
  type ProxyNode,
} from "../src/index.js";
import { fixture, trojan } from "./fixtures.js";
const mac = { engine: "surge", platform: "macos", version: "6.10.0" } as const;
function compileEverywhere(node: ProxyNode) {
  return [
    compile(fixture([], { nodes: [node] })),
    compileProxyNodes({ target: mac, nodes: [node] }),
    compileSurgeProfile({
      target: mac,
      nodes: [node],
      groups: [],
      rules: [],
      fallback: outbound.direct,
    }),
    ...[mac, { engine: "sing-box", platform: "linux", version: "1.12.0" } as const].map((target) =>
      compileProfile({
        target,
        proxies: [node],
        groups: [],
        routes: [],
        fallback: outbound.direct,
      }),
    ),
  ];
}
// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("every compiler rejects business fields, including non-enumerable raw properties", () => {
  assert.ok(compileEverywhere(trojan).every((result) => result.ok));
  for (const field of ["region", "provider", "tags"]) {
    for (const enumerable of [true, false]) {
      // Pass this exact object to each API; never spread it after defining the property.
      const raw = Object.defineProperty({ ...trojan }, field, {
        value: "private-marker",
        enumerable,
      });
      for (const result of compileEverywhere(raw)) {
        assert.equal(result.ok, false, `${field}: ${enumerable}`);
        assert.doesNotMatch(JSON.stringify(result), /private-marker/);
      }
    }
  }
});
// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("compiler data boundaries reject accessors and symbols without reading payloads", () => {
  let reads = 0;
  const raw = Object.defineProperty({ ...trojan }, "region", {
    get() {
      reads++;
      throw Error("private-marker");
    },
  });
  assert.ok(compileEverywhere(raw).every((result) => !result.ok));
  assert.equal(reads, 0);
  const symbol = Object.defineProperty({ ...trojan }, Symbol("private-marker"), {
    value: "private-marker",
    enumerable: true,
  });
  assert.ok(compileEverywhere(symbol).every((result) => !result.ok));
});
// @use-case docs/feature/rule-composition/use-case/select-resources.md
test("application filters preserve proxy identity, member order and device subsets", () => {
  const entries = [
    { region: "local-zone-A", proxy: { ...trojan, id: "second", label: "Second" } },
    { region: "local-zone-B", proxy: { ...trojan, id: "first", label: "First" } },
    { region: "local-zone-A", proxy: { ...trojan, id: "excluded", label: "Excluded" } },
  ];
  const device = entries.slice(0, 2);
  const supplier = new Set([entries[0]!.proxy, entries[2]!.proxy]);
  const members = device
    .filter((entry) => ["local-zone-B", "local-zone-A"].includes(entry.region))
    .map((entry) => entry.proxy);
  assert.equal(members[0], entries[0]!.proxy);
  assert.equal(members[1], entries[1]!.proxy);
  const supplierMembers = device.map((entry) => entry.proxy).filter((proxy) => supplier.has(proxy));
  assert.deepEqual(supplierMembers, [entries[0]!.proxy]);
  const choice = defineProxyGroup({
    id: "choice",
    name: "Choice",
    algorithm: group.select(),
    members,
  });
  const definition = {
    target: mac,
    proxies: device.map((entry) => entry.proxy),
    groups: [choice],
    routes: [],
    fallback: choice,
  };
  const result = compileProfile(definition);
  assert.equal(result.ok, true);
  assert.equal(result.engine, "surge");
  if (result.engine === "surge")
    assert.match(
      renderSurgeProfile(result.compilation, () => "fixture").content,
      /Choice = select, Second, First/,
    );
  const copied = { ...choice, members: members.map((proxy) => ({ ...proxy })) };
  assert.equal(compileProfile({ ...definition, groups: [copied], fallback: copied }).ok, false);
});
