import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  defineProxyGroup,
  defineRoute,
  defineSurgeProfile,
  selectProxies,
  outbound,
  ProfileDefinitionError,
  proxy,
  group,
  surge,
  secret,
  compileSurgeProfile,
  renderSurgeProfile,
  type SurgeProfileDefinition,
  type SurgeCondition,
} from "../src/index.js";

function fixture(): SurgeProfileDefinition {
  const node = proxy.trojan({
    id: "node",
    label: "Node",
    server: "192.0.2.1",
    port: 443,
    password: secret("PASS"),
    region: "SG",
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
      defineRoute({ id: "local", when: surge.match.domain("example.com"), to: outbound.direct }),
      defineRoute({
        id: "remote",
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
  const lowered = defineSurgeProfile(definition);
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
  assert.deepEqual(
    selectProxies(definition.nodes, { ids: ["node"], regions: ["SG"] }),
    definition.nodes,
  );
  assert.equal(selectProxies(definition.nodes)[0], definition.nodes[0]);
  assert.deepEqual(selectProxies(definition.nodes, { ids: ["missing"] }), []);
});
test("references require registered instances and unique resource and route identities", () => {
  const input = fixture();
  rejects(
    () => defineSurgeProfile({ ...input, fallback: { ...input.nodes[0]! } }),
    "UNREGISTERED_DESTINATION_INSTANCE",
  );
  rejects(
    () => defineSurgeProfile({ ...input, groups: [input.groups[0]!] }),
    "UNREGISTERED_DESTINATION_INSTANCE",
  );
  rejects(
    () => defineSurgeProfile({ ...input, nodes: [...input.nodes, input.nodes[0]!] }),
    "DUPLICATE_RESOURCE_ID",
  );
  rejects(
    () => defineSurgeProfile({ ...input, routes: [...input.routes, input.routes[0]!] }),
    "DUPLICATE_ROUTE_ID",
  );
  rejects(
    () => defineSurgeProfile({ ...input, names: { choice: "Different" } }),
    "GROUP_NAME_CONFLICT",
  );
  const unknown = defineSurgeProfile({ ...input, names: { unknown: "Unknown" } });
  assert.equal(compileSurgeProfile(unknown).ok, false);
  const cyclic = fixture();
  (cyclic.groups[0]!.members as unknown[]).push(cyclic.groups[0]);
  rejects(() => defineSurgeProfile(cyclic), "DEFINITION_CYCLE");
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
    () => defineSurgeProfile(bad as never),
    () => selectProxies([], bad),
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
  const route = defineRoute({ id: "expanded", when: condition, to: outbound.direct });
  rejects(
    () => defineSurgeProfile({ ...input, routes: [route] }),
    "DEFINITION_OUTPUT_BUDGET_EXCEEDED",
  );
  const large = Array.from({ length: 20001 }, () => ({}));
  rejects(() => selectProxies(large as never), "DEFINITION_OBJECT_BUDGET_EXCEEDED");
  rejects(
    () => selectProxies(Array(100001).fill(input.nodes[0])),
    "DEFINITION_EDGE_BUDGET_EXCEEDED",
  );
  let nested: unknown = {};
  for (let i = 0; i < 64; i++) nested = { child: nested };
  rejects(() => selectProxies([nested] as never), "DEFINITION_DEPTH_EXCEEDED");
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
  const lowered = defineSurgeProfile({
    ...input,
    routes: conditions.map((when, index) =>
      defineRoute({ id: `r${index}`, when, to: outbound.direct }),
    ),
  });
  assert.equal(compileSurgeProfile(lowered).ok, true);
});
