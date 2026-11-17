import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  defineProfile,
  defineRoutes,
  match,
  surge,
  outbound,
  ruleSet,
  explainProfile,
  ProfileDefinitionError,
  type Condition,
  type RouteRequest,
  type Target,
  type Assumptions,
} from "proxylang";
import { combine, type Truth } from "../../src/routing/evaluate.js";
const surgeTarget = { engine: "surge", platform: "macos", version: "6.10.0" } as const;
const make = (when: Condition, target: Target = surgeTarget) => {
  const common = {
    proxies: [],
    groups: [],
    routes: defineRoutes({ when, to: outbound.direct }),
    fallback: outbound.reject,
  };
  if (target.engine === "sing-box")
    return defineProfile({ ...common, target, singBox: { mode: "fragment" } });
  if (target.engine === "mihomo")
    return defineProfile({ ...common, target, mihomo: { mode: "fragment" } });
  if (target.engine === "surge") return defineProfile({ ...common, target });
  return defineProfile({ ...common, target });
};
const explain = (when: Condition, request: RouteRequest = {}, assume?: Assumptions) => {
  const result = explainProfile(make(when), request, assume);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw Error("invalid fixture");
  return result.explanation;
};
// @feature docs/feature/routing-cases/README.md#顺序与三值
test("all and any cover the full three-value table, choose the first need and evaluate every child", () => {
  const values: Truth[] = [
    { matched: false },
    { matched: true },
    { matched: null, needs: { kind: "dns" } },
  ];
  for (const a of values)
    for (const b of values) {
      const all = combine("all", [a, b]);
      const any = combine("any", [a, b]);
      assert.equal(
        all.matched,
        a.matched === false || b.matched === false
          ? false
          : a.matched === null || b.matched === null
            ? null
            : true,
      );
      assert.equal(
        any.matched,
        a.matched === true || b.matched === true
          ? true
          : a.matched === null || b.matched === null
            ? null
            : false,
      );
    }
  const sets = [
    ruleSet({ id: "first", surge: { url: "https://rules.example.com/first" } }),
    ruleSet({ id: "second", surge: { url: "https://rules.example.com/second" } }),
  ];
  assert.deepEqual(explain(match.all(...sets)).needs, { kind: "ruleSet", id: "first" });
  assert.deepEqual(explain(match.any(...sets)).needs, { kind: "ruleSet", id: "first" });
  assert.equal(explain(match.all(sets[0]!, match.domain("example.com"))).outcome, "fallback");
  assert.equal(
    explain(match.any(sets[0]!, match.not(match.domain("example.com")))).outcome,
    "matched",
  );
  assert.equal(explain(match.not(sets[0]!)).outcome, "indeterminate");
});
// @feature docs/feature/routing-cases/README.md#原子条件
test("every atomic condition matches, misses and observes missing-field semantics", () => {
  const atoms: [Condition, RouteRequest, RouteRequest][] = [
    [match.domain("example.com"), { domain: "example.com" }, { domain: "other.example" }],
    [
      match.domainSuffix("example.com"),
      { domain: "sub.example.com" },
      { domain: "notexample.com" },
    ],
    [match.ipCidr("192.0.2.0/25", { noResolve: true }), { ip: "192.0.2.7" }, { ip: "192.0.2.200" }],
    [
      surge.match.ipCidr6("2001:db8:1::/48", { noResolve: true }),
      { ip: "2001:db8:1::1" },
      { ip: "2001:db8:2::1" },
    ],
    [
      surge.match.ipAsn(64512, { noResolve: true }),
      { ip: "192.0.2.7", asn: 64512 },
      { ip: "192.0.2.7", asn: 64513 },
    ],
    [match.sourceIp("192.0.2.0/25"), { sourceIp: "192.0.2.2" }, { sourceIp: "192.0.2.200" }],
    [match.port(443, 445), { port: 444 }, { port: 446 }],
    [match.sourcePort(1000, 1002), { sourcePort: 1000 }, { sourcePort: 999 }],
    [match.processName("Example"), { processName: "Example" }, { processName: "example" }],
    [
      surge.match.macAddress("02:ab:00:00:00:01"),
      { macAddress: "02:AB:00:00:00:01" },
      { macAddress: "02:ab:00:00:00:02" },
    ],
    [match.network("udp"), { network: "udp" }, { network: "tcp" }],
  ];
  for (const [condition, hit, miss] of atoms) {
    assert.equal(explain(condition, hit).outcome, "matched", condition.type);
    assert.equal(explain(condition, miss).outcome, "fallback", condition.type);
    assert.equal(explain(condition).outcome, "fallback", condition.type);
    assert.equal(explain(match.not(condition)).outcome, "matched", condition.type);
  }
  assert.equal(explain(match.network("tcp")).outcome, "matched");
  assert.equal(
    explain(match.domainSuffix("example.com"), { domain: "example.com" }).outcome,
    "matched",
  );
  assert.deepEqual(explain(surge.match.ipAsn(64512), { ip: "192.0.2.7" }).needs, { kind: "asn" });
});
// @feature docs/feature/routing-cases/README.md#域名与嗅探
test("sniffed domains follow Surge options and sing-box effective-domain preference", () => {
  const request = { domain: "other.example", sniffedDomain: "example.com" };
  assert.equal(explain(match.domain("example.com"), request).outcome, "fallback");
  assert.equal(
    explain(match.domain("example.com", { includeSniffed: true }), request).outcome,
    "matched",
  );
  const profile = defineProfile({
    target: { engine: "sing-box", platform: "linux", version: "1.14.4" },
    singBox: { mode: "fragment", domainMatching: "prefer-sniffed" },
    proxies: [],
    groups: [],
    routes: defineRoutes({ when: match.domain("example.com"), to: outbound.direct }),
    fallback: outbound.reject,
  });
  for (const [input, expected] of [
    [request, "matched"],
    [{ domain: "example.com", sniffedDomain: "other.example" }, "fallback"],
    [{ domain: "example.com" }, "matched"],
  ] as const) {
    const r = explainProfile(profile, input);
    assert.ok(r.ok);
    assert.equal(r.explanation.outcome, expected);
  }
  for (const target of [
    { engine: "sing-box", version: "1.12.0", platform: "linux" },
    { engine: "mihomo", version: "1.19.32", platform: "linux" },
    { engine: "stash", version: "4.2.1", platform: "macos" },
  ] as const) {
    const p = make(match.domain("example.com"), target);
    const r = explainProfile(p, request);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.explanation.outcome, "fallback");
  }
});
// @feature docs/feature/routing-cases/README.md#ip-与解析
test("target resolution defaults, explicit suppression and explicit triggers", () => {
  const targets: Target[] = [
    surgeTarget,
    { engine: "sing-box", version: "1.12.0", platform: "linux" },
    { engine: "sing-box", version: "1.14.4", platform: "linux" },
    { engine: "mihomo", version: "1.19.32", platform: "linux" },
    { engine: "stash", version: "4.2.1", platform: "macos" },
  ];
  for (const target of targets)
    for (const noResolve of [undefined, true, false]) {
      const condition = match.ipCidr("192.0.2.0/25", noResolve === undefined ? {} : { noResolve });
      const profile = make(condition, target);
      if (target.engine === "sing-box" && target.version === "1.12.0" && noResolve !== undefined) {
        const r = explainProfile(profile, {});
        assert.ok(!r.ok);
        continue;
      }
      const triggers =
        target.engine === "surge" || (target.engine === "sing-box" && target.version === "1.14.4")
          ? noResolve !== true
          : (target.engine === "mihomo" || target.engine === "stash") && noResolve === false;
      for (const [request, outcome] of [
        [{}, triggers ? "indeterminate" : "fallback"],
        [{ resolvedIp: "192.0.2.7" }, triggers ? "matched" : "fallback"],
        [{ ip: "192.0.2.7" }, "matched"],
      ] as const) {
        const r = explainProfile(profile, request);
        assert.ok(r.ok, JSON.stringify(r));
        assert.equal(
          r.explanation.outcome,
          outcome,
          `${target.engine}/${target.version}/${noResolve}`,
        );
        if (outcome === "indeterminate") assert.deepEqual(r.explanation.needs, { kind: "dns" });
      }
    }
});
// @feature docs/feature/routing-cases/README.md#ip-与解析
test("top-level misses retain resolved state for later nested hits and misses; nested triggers do not advance state", () => {
  for (const condition of [
    match.all(match.ipCidr("192.0.2.0/25"), match.network("tcp")),
    match.any(match.ipCidr("192.0.2.0/25"), match.network("udp")),
    match.not(match.ipCidr("192.0.2.128/25")),
  ]) {
    assert.deepEqual(explain(condition, { resolvedIp: "192.0.2.7" }).needs, { kind: "dns" });
    assert.equal(explain(condition, { ip: "192.0.2.7" }).outcome, "matched");
    const profile = defineProfile({
      target: surgeTarget,
      proxies: [],
      groups: [],
      routes: [
        defineRoutes({ when: match.ipCidr("192.0.2.128/26"), to: outbound.reject }),
        defineRoutes({ when: condition, to: outbound.direct }),
      ],
      fallback: outbound.reject,
    });
    const hit = explainProfile(profile, { resolvedIp: "192.0.2.7" });
    assert.ok(hit.ok);
    assert.equal(hit.explanation.outcome, "matched");
    assert.equal(hit.explanation.route?.index, 1);
    assert.deepEqual(
      hit.explanation.trace.map((t) => t.matched),
      [false, true],
    );
    const miss = explainProfile(profile, { resolvedIp: "192.0.2.200" });
    assert.ok(miss.ok);
    assert.equal(miss.explanation.outcome, "fallback");
  }
  const condition = match.all(match.ipCidr("192.0.2.0/25"), match.network("tcp"));
  const invalid = explainProfile(
    make(condition, { engine: "sing-box", version: "1.14.4", platform: "linux" }),
    { ip: "192.0.2.7" },
  );
  assert.ok(!invalid.ok);
  assert.ok(invalid.diagnostics.some((d) => d.code === "RESOLVE_NESTED"));
});
// @feature docs/feature/routing-cases/README.md#假设
test("assumptions enforce identity, route use and native de-duplication; rule-set resolution precedes a miss", () => {
  const source = {
    url: "https://rules.example.com/example.json",
    format: "source" as const,
    intervalSeconds: 86400,
  };
  const first = ruleSet({ id: "first", singBox: { ...source, resolve: true } }),
    second = ruleSet({ id: "second", singBox: { ...source, resolve: true } }),
    foreign = ruleSet({ id: "first", singBox: source });
  const profile = defineProfile({
    target: { engine: "sing-box", platform: "linux", version: "1.14.4" },
    singBox: { mode: "fragment" },
    proxies: [],
    groups: [],
    routes: [
      defineRoutes({ when: [first, second], to: outbound.reject }),
      defineRoutes({
        when: match.ipCidr("192.0.2.0/25", { noResolve: true }),
        to: outbound.direct,
      }),
    ],
    fallback: outbound.reject,
  });
  const miss = explainProfile(profile, { resolvedIp: "192.0.2.7" }, { miss: [first] });
  assert.ok(miss.ok);
  assert.equal(miss.explanation.exit, "DIRECT");
  const dns = explainProfile(profile, {}, { miss: [first, second] });
  assert.ok(dns.ok);
  assert.deepEqual(dns.explanation.needs, { kind: "dns" });
  assert.deepEqual(
    dns.explanation.trace.map((t) => t.matched),
    [false, false, null],
  );
  const hitWithoutIp = explainProfile(profile, { domain: "example.com" }, { hit: [first] });
  assert.ok(hitWithoutIp.ok);
  assert.equal(hitWithoutIp.explanation.exit, "REJECT");
  assert.equal(hitWithoutIp.explanation.route?.index, 0);
  const noAssumption = explainProfile(profile, { domain: "example.com" });
  assert.ok(noAssumption.ok);
  assert.deepEqual(noAssumption.explanation.needs, { kind: "ruleSet", id: "first" });
  const domainAfter = defineProfile({
    ...profile,
    routes: [
      defineRoutes({ when: first, to: outbound.reject }),
      defineRoutes({ when: match.domain("example.com"), to: outbound.direct }),
    ],
  });
  const domainHit = explainProfile(domainAfter, { domain: "example.com" }, { miss: [first] });
  assert.ok(domainHit.ok);
  assert.equal(domainHit.explanation.exit, "DIRECT");
  assert.deepEqual(
    domainHit.explanation.trace.map((t) => t.matched),
    [false, true],
  );

  for (const [assume, code] of [
    [{ hit: [first], miss: [second] }, "INVALID_ASSUMPTIONS"],
    [{ hit: [first], miss: [first] }, "INVALID_ASSUMPTIONS"],
    [{ hit: [foreign] }, "ASSUMPTION_UNKNOWN_RULESET"],
    [{ hit: [surge.ruleSets.lan] }, "ASSUMPTION_UNKNOWN_RULESET"],
  ] as const) {
    const r = explainProfile(profile, { ip: "192.0.2.7" }, assume);
    assert.ok(!r.ok);
    assert.ok(r.diagnostics.some((d) => d.code === code));
  }
  assert.equal(explain(surge.ruleSets.lan, {}, { hit: [surge.ruleSets.lan] }).outcome, "matched");
  assert.equal(explain(surge.ruleSets.system).needs?.kind, "ruleSet");
});
// @feature docs/feature/routing-cases/library.md#routerequest
test("requests reject unknown fields, invalid values and conflicting IP sources with field paths", () => {
  for (const [key, value] of Object.entries({
    unknown: true,
    network: "icmp",
    domain: "UPPER.example",
    sniffedDomain: "https://example.com",
    ip: "192.0.2.0/25",
    resolvedIp: "bad",
    port: 0,
    sourcePort: 65536,
    sourceIp: "not-ip",
    asn: 0,
    macAddress: "00:00",
    processName: "bad\nname",
  }))
    assert.throws(
      () => explainProfile(make(match.network("tcp")), { [key]: value } as never),
      (e: unknown) =>
        e instanceof ProfileDefinitionError &&
        e.code === "INVALID_REQUEST" &&
        !!e.paths?.includes(key),
      key,
    );
  assert.throws(
    () => explainProfile(make(match.network("tcp")), { ip: "192.0.2.1", resolvedIp: "192.0.2.2" }),
    (e: unknown) => e instanceof ProfileDefinitionError && e.code === "INVALID_REQUEST",
  );
});

// @feature docs/feature/routing-cases/README.md#ip-与解析
test("single-child all/any retain nested resolution semantics", () => {
  for (const condition of [
    match.all(match.ipCidr("192.0.2.0/24")),
    match.any(match.ipCidr("192.0.2.0/24")),
  ]) {
    assert.deepEqual(explain(condition, { resolvedIp: "192.0.2.7" }).needs, { kind: "dns" });
    assert.equal(explain(condition, { ip: "192.0.2.7" }).outcome, "matched");
    assert.equal(explain(condition, { ip: "2001:db8::1" }).outcome, "fallback");
  }
});
