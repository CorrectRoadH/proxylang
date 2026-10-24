import { lowerSurgeProfile, type SurgeDefinitionInput } from "../src/surge-definitions.js";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  defineProxyGroup,
  defineRoute,
  defineRoutes,
  outbound,
  ProfileDefinitionError,
  proxy,
  group,
  surge,
  secret,
  compileSurgeProfile,
  renderSurgeProfile,
  type SurgeCondition,
} from "../src/index.js";

function fixture(): SurgeDefinitionInput {
  const node = proxy.trojan({
    id: "node",
    label: "Node",
    server: "192.0.2.1",
    port: 443,
    password: secret("PASS"),
  });
  const smart = defineProxyGroup({
    id: "smart",
    name: "Smart",
    algorithm: surge.smart(),
    members: [node],
  });
  const choice = defineProxyGroup({
    id: "choice",
    name: "Choice",
    algorithm: group.select(),
    members: [smart, outbound.direct],
  });
  return {
    target: { engine: "surge", platform: "macos", version: "6.10.0" },
    nodes: [node],
    groups: [choice, smart],
    routes: [
      defineRoute({ when: surge.match.domain("example.com"), to: outbound.direct }),
      defineRoute({
        when: surge.match.ipCidr("10.0.0.0/8", { noResolve: true }),
        to: choice,
      }),
    ],
    fallback: choice,
  };
}
function rejects(run: () => unknown, code: string) {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof ProfileDefinitionError && error.code === code && error.message === code,
  );
}
// @use-case docs/feature/target-compilation/use-case/surge-profile.md
test("object definitions lower in declared order, compile, and detach snapshots", () => {
  const definition = fixture();
  const lowered = lowerSurgeProfile(definition);
  const compiled = compileSurgeProfile(lowered);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const output = renderSurgeProfile(compiled, () => "fixture").content;
  assert.match(output, /Choice = select, Smart, DIRECT\nSmart = smart, Node/);
  assert.match(
    output,
    /DOMAIN,example.com,DIRECT\nIP-CIDR,10.0.0.0\/8,Choice,no-resolve\nFINAL,Choice/,
  );
  (definition.nodes[0] as { server: string }).server = "changed.example";
  (definition.routes[0]!.when as { value: string }).value = "changed.example";
  assert.equal(lowered.nodes[0]!.server, "192.0.2.1");
  assert.deepEqual(lowered.rules[0]!.when, { type: "domain", value: "example.com" });
});
test("references require registered instances and unique resource identities", () => {
  const input = fixture();
  rejects(
    () => lowerSurgeProfile({ ...input, fallback: { ...input.nodes[0]! } }),
    "UNREGISTERED_DESTINATION_INSTANCE",
  );
  rejects(
    () => lowerSurgeProfile({ ...input, groups: [input.groups[0]!] }),
    "UNREGISTERED_DESTINATION_INSTANCE",
  );
  rejects(
    () => lowerSurgeProfile({ ...input, nodes: [...input.nodes, input.nodes[0]!] }),
    "DUPLICATE_RESOURCE_ID",
  );
  assert.equal(
    lowerSurgeProfile({ ...input, routes: [...input.routes, input.routes[0]!] }).rules.length,
    3,
  );
  rejects(
    () => lowerSurgeProfile({ ...input, names: { choice: "Different" } }),
    "GROUP_NAME_CONFLICT",
  );
  const unknown = lowerSurgeProfile({ ...input, names: { unknown: "Unknown" } });
  assert.equal(compileSurgeProfile(unknown).ok, false);
  const cyclic = fixture();
  (cyclic.groups[0]!.members as unknown[]).push(cyclic.groups[0]);
  rejects(() => lowerSurgeProfile(cyclic), "DEFINITION_CYCLE");
});
test("constructors reject accessors without invoking them or exposing payloads", () => {
  let reads = 0;
  const bad = Object.defineProperty({}, "secret", {
    enumerable: true,
    get() {
      reads++;
      throw Error("private-value");
    },
  });
  for (const run of [
    () => defineProxyGroup(bad as never),
    () => defineRoute(bad as never),
    () => defineRoutes(bad as never),
    () => lowerSurgeProfile(bad as never),
    () => surge.match.domain("example.com", bad),
    () => surge.match.all([], bad),
    () => surge.match.ruleSet(bad as never),
  ])
    rejects(run, "DEFINITION_NOT_DATA");
  assert.equal(reads, 0);
  rejects(
    () =>
      defineProxyGroup({ id: "x", name: "x", algorithm: { type: "auto" } as never, members: [] }),
    "UNSUPPORTED_GROUP_ALGORITHM",
  );
});
test("shared object DAG is checked once but expanded output has an independent bound", () => {
  const input = fixture();
  let condition: SurgeCondition = surge.match.domain("example.com");
  for (let i = 0; i < 18; i++) condition = surge.match.all([condition, condition]);
  const route = defineRoute({ when: condition, to: outbound.direct });
  rejects(
    () => lowerSurgeProfile({ ...input, routes: [route] }),
    "DEFINITION_OUTPUT_BUDGET_EXCEEDED",
  );
  const large = Array.from({ length: 20001 }, () => ({}));
  rejects(
    () => defineRoute({ when: large as never, to: outbound.direct }),
    "DEFINITION_OBJECT_BUDGET_EXCEEDED",
  );
  rejects(
    () => defineRoute({ when: Array(100001).fill(input.nodes[0]) as never, to: outbound.direct }),
    "DEFINITION_EDGE_BUDGET_EXCEEDED",
  );
  let nested: unknown = {};
  for (let i = 0; i < 64; i++) nested = { child: nested };
  rejects(
    () => defineRoute({ when: nested as never, to: outbound.direct }),
    "DEFINITION_DEPTH_EXCEEDED",
  );
});
test("Surge match preserves options, source literals and nested conditions", () => {
  const input = fixture();
  const conditions = [
    surge.match.sourceIp("192.168.0.2"),
    surge.match.ipCidr6("2001:db8::/32", { noResolve: true }),
    surge.match.port(80, 443),
    surge.match.sourcePort(1234),
    surge.match.network("tcp"),
    surge.match.processName("curl"),
    surge.match.macAddress("aa:bb:cc:dd:ee:ff"),
    surge.match.ruleSet({ format: "rule-set", builtin: "LAN" }),
    surge.match.not(surge.match.domainSuffix("example.org")),
    surge.match.any([surge.match.domain("a.example"), surge.match.domain("b.example")]),
  ];
  const lowered = lowerSurgeProfile({
    ...input,
    routes: conditions.map((when) => defineRoute({ when, to: outbound.direct })),
  });
  assert.equal(compileSurgeProfile(lowered).ok, true);
});

// @use-case docs/feature/target-compilation/use-case/surge-profile.md
test("route batches preserve empty, duplicate and ordered conditions without IDs", () => {
  const a = surge.match.domain("a.example");
  const b = surge.match.domain("b.example");
  assert.deepEqual(defineRoutes({ when: [], to: outbound.direct }), []);
  const routes = defineRoutes({ when: [a, b, a], to: outbound.direct });
  const profile = lowerSurgeProfile({ ...fixture(), routes });
  assert.deepEqual(
    profile.rules.map((rule) => rule.when),
    [a, b, a],
  );
  rejects(
    () => defineRoute({ id: "legacy", when: a, to: outbound.direct } as never),
    "DEFINITION_UNKNOWN_FIELD",
  );
});
