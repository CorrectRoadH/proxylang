import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  compile,
  compileProfile,
  compileSurgeProfile,
  defineRoute,
  direct,
  match,
  outbound,
  rule,
  ruleSet,
  surge,
  type Engine,
  type Match,
  type Target,
} from "../src/index.js";
import { evaluate } from "../src/rules.js";
import { fixture } from "./fixtures.js";
const mac = { engine: "surge", platform: "macos", version: "6.10.0" } as const;
const base = { target: mac, proxies: [], groups: [], routes: [], fallback: outbound.direct };
function program(conditions: Match[], engine: Engine = "surge") {
  const targets: Record<Engine, Omit<Target, "id" | "program">> = {
    surge: mac,
    "sing-box": { engine: "sing-box", platform: "linux", version: "1.12.0" },
    mihomo: { engine: "mihomo", platform: "linux", version: "1.19.32" },
    stash: { engine: "stash", platform: "macos", version: "4.2.1" },
  };
  const config = fixture(
    conditions.map((when, i) => rule(`rule-${i}`, when, i % 2 ? { type: "reject" } : direct())),
    { engine },
  );
  return compile({
    ...config,
    targets: [{ ...targets[engine], id: "test", program: "home" } as Target],
  });
}
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("includeSniffed adds observed names without replacing destination or widening backend support", () => {
  for (const includeSniffed of [undefined, false, true]) {
    const opts = includeSniffed === undefined ? {} : { includeSniffed };
    const request = {
      network: "tcp" as const,
      domain: "a.example",
      tlsSni: "b.example",
      httpHost: "c.example",
    };
    for (const [name, expected] of [
      ["a.example", true],
      ["b.example", includeSniffed === true],
      ["c.example", includeSniffed === true],
    ] as const) {
      const atom = match.domain(name, opts);
      assert.equal(evaluate(atom, request).matched, expected);
      assert.equal(evaluate(match.not(atom), request).matched, !expected);
      assert.equal(evaluate(atom, { network: "tcp" }).matched, false);
    }
    const atom = match.domain("a.example", opts);
    for (const engine of ["surge", "sing-box", "mihomo", "stash"] as const) {
      for (const when of [
        atom,
        match.any(match.not(atom), match.port(443)),
        ruleSet({ id: "named", when: atom }),
      ]) {
        const result = program([when], engine);
        assert.equal(
          result.ok,
          !includeSniffed || engine === "surge",
          JSON.stringify(result.diagnostics),
        );
        if (includeSniffed && engine !== "surge")
          assert.ok(result.diagnostics.some((d) => d.code === "MATCH_OPTION_UNSUPPORTED"));
      }
    }
    for (const target of [
      mac,
      { engine: "sing-box", platform: "linux", version: "1.12.0" } as const,
    ]) {
      for (const when of [atom, match.not(ruleSet({ id: "named", when: atom }))]) {
        const result = compileProfile({
          ...base,
          target,
          routes: [defineRoute({ when, to: outbound.direct })],
        });
        assert.equal(
          result.ok,
          !includeSniffed || target.engine === "surge",
          JSON.stringify(result),
        );
      }
    }
    assert.ok(
      compileSurgeProfile({
        target: mac,
        nodes: [],
        groups: [],
        rules: [{ when: atom, then: outbound.direct }],
        fallback: outbound.direct,
      }).ok,
    );
    const remote = surge.ruleSet({ url: "https://example.com/rules", ...opts });
    assert.ok(program([remote]).ok);
    assert.ok(
      compileProfile({ ...base, routes: [defineRoute({ when: remote, to: outbound.direct })] }).ok,
    );
  }
});
// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
test("resource identity equates false with omitted and checks Profile before discarding IDs", () => {
  const url = "https://example.com/rules";
  const implicit = surge.ruleSet({ id: "shared", url });
  const explicit = surge.ruleSet({ id: "shared", url, includeSniffed: false });
  const extended = surge.ruleSet({ id: "shared", url, includeSniffed: true });
  assert.equal(surge.ruleSet({ url }).id, surge.ruleSet({ url, includeSniffed: false }).id);
  assert.notEqual(surge.ruleSet({ url }).id, surge.ruleSet({ url, includeSniffed: true }).id);
  assert.equal(explicit.includeSniffed, false);
  assert.notEqual(surge.ruleSet({ url }).id, surge.ruleSet({ url, noResolve: false }).id);
  for (const nested of [false, true]) {
    const named = (includeSniffed?: boolean) =>
      ruleSet({
        id: "named",
        when: match.domain("example.com", includeSniffed === undefined ? {} : { includeSniffed }),
      });
    const first = nested ? named() : implicit;
    const same = nested ? named(false) : explicit;
    const different = nested ? named(true) : extended;
    assert.ok(program([first, same]).ok);
    assert.ok(
      program([first, different]).diagnostics.some((d) => d.code === "RULESET_ID_CONFLICT"),
    );
    for (const conditions of [
      [first, same],
      [first, different],
    ]) {
      const result = compileProfile({
        ...base,
        routes: conditions.map((when, i) =>
          defineRoute({ when: match.not(when), to: i ? outbound.reject : outbound.direct }),
        ),
      });
      assert.equal(result.ok, conditions[1] === same, JSON.stringify(result));
      if (!result.ok) assert.ok(JSON.stringify(result).includes("RULESET_ID_CONFLICT"));
    }
  }
  // Matching options belong to individual rules, not URL fetch resources.
  assert.ok(
    compileProfile({
      ...base,
      routes: [
        surge.ruleSet({ url, includeSniffed: true, to: outbound.direct }),
        surge.ruleSet({ url, includeSniffed: false, to: outbound.reject }),
      ],
    }).ok,
  );
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("constructors retain snapshots and reject invalid fields across raw compilation entrances", () => {
  const opts = { includeSniffed: true };
  const atom = match.domain("example.com", opts);
  opts.includeSniffed = false;
  assert.equal(atom.includeSniffed, true);
  const invalidConditions = [
    ...[null, 1, "true", []].map((includeSniffed) => ({
      type: "domain",
      value: "example.com",
      includeSniffed,
    })),
    { type: "domain", value: "example.com", sources: ["destination"] },
    { type: "domain", value: "example.com", extendedMatching: true },
    {
      type: "all",
      conditions: [match.domain("example.com"), match.port(443)],
      includeSniffed: false,
    },
    { type: "ipCidr", value: "192.0.2.0/24", includeSniffed: false },
    { type: "processName", value: "app", includeSniffed: false },
    { type: "ruleSet", id: "named", when: match.domain("example.com"), includeSniffed: false },
  ];
  for (const raw of invalidConditions) {
    assert.equal(program([raw as Match]).ok, false);
    for (const target of [
      mac,
      { engine: "sing-box", platform: "linux", version: "1.12.0" } as const,
    ]) {
      assert.equal(
        compileProfile({
          ...base,
          target,
          routes: [defineRoute({ when: raw as Match, to: outbound.direct })],
        }).ok,
        false,
      );
    }
    assert.equal(
      compileSurgeProfile({
        target: mac,
        nodes: [],
        groups: [],
        rules: [{ when: raw, then: outbound.direct }],
        fallback: outbound.direct,
      }).ok,
      false,
    );
  }
  for (const includeSniffed of [null, 1, "true", []]) {
    assert.throws(() => match.domain("example.com", { includeSniffed } as never));
    assert.throws(() =>
      surge.ruleSet({ url: "https://example.com/rules", includeSniffed } as never),
    );
  }
  assert.throws(() => match.domain("example.com", { sources: ["destination"] } as never));
  for (const extra of ["sources", "includeSniffed", Symbol("unknown")]) {
    const raw = Object.defineProperty({ id: "named", when: match.domain("example.com") }, extra, {
      value: false,
    });
    assert.throws(() => ruleSet(raw));
  }
  let reads = 0;
  const getter = {
    get includeSniffed() {
      reads++;
      return true;
    },
  };
  assert.throws(() => match.domain("example.com", getter));
  assert.throws(() =>
    ruleSet({
      id: "named",
      get when() {
        reads++;
        return atom;
      },
    }),
  );
  assert.equal(reads, 0);
});
