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
  type DomainSource,
  type Engine,
  type Match,
  type Target,
} from "../src/index.js";
import { evaluate } from "../src/rules.js";
import { fixture } from "./fixtures.js";
const all: DomainSource[] = ["destination", "tlsSni", "httpHost"];
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
test("every domain source subset keeps static semantics and exact backend boundaries", () => {
  for (let bits = 1; bits < 8; bits++) {
    const sources = all.filter((_, i) => bits & (1 << i));
    const atom = match.domain("example.com", { sources });
    for (const source of all) {
      const request = {
        network: "tcp" as const,
        domain: "other.net",
        tlsSni: "other.net",
        httpHost: "other.net",
        [source === "destination" ? "domain" : source]: "example.com",
      };
      assert.equal(evaluate(atom, request).matched, sources.includes(source));
      assert.equal(evaluate(match.not(atom), request).matched, !sources.includes(source));
    }
    assert.equal(evaluate(atom, { network: "tcp" }).matched, false);
    for (const engine of ["surge", "sing-box", "mihomo", "stash"] as const) {
      const supported = bits === 1 || (engine === "surge" && bits === 7);
      for (const when of [
        atom,
        match.any(match.not(atom), match.port(443)),
        ruleSet({ id: "named", when: atom }),
      ]) {
        const result = program([when], engine);
        assert.equal(result.ok, supported, JSON.stringify(result.diagnostics));
        if (!supported)
          assert.ok(result.diagnostics.some((d) => d.code === "MATCH_OPTION_UNSUPPORTED"));
      }
    }
    for (const target of [
      mac,
      { engine: "sing-box", platform: "linux", version: "1.12.0" } as const,
    ]) {
      const result = compileProfile({
        ...base,
        target,
        routes: [defineRoute({ when: atom, to: outbound.direct })],
      });
      assert.equal(
        result.ok,
        bits === 1 || (target.engine === "surge" && bits === 7),
        JSON.stringify(result),
      );
    }
    const raw = compileSurgeProfile({
      target: mac,
      nodes: [],
      groups: [],
      rules: [{ when: atom, then: outbound.direct }],
      fallback: outbound.direct,
    });
    assert.equal(raw.ok, bits === 1 || bits === 7);
    const remote = surge.ruleSet({ url: "https://example.com/rules", sources });
    assert.equal(program([remote]).ok, bits === 1 || bits === 7);
    assert.equal(
      compileProfile({ ...base, routes: [defineRoute({ when: remote, to: outbound.direct })] }).ok,
      bits === 1 || bits === 7,
    );
  }
});
// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
test("source identity ignores permutation and explicit default without changing author snapshots", () => {
  const permutations = [
    all,
    [all[0]!, all[2]!, all[1]!],
    [all[1]!, all[0]!, all[2]!],
    [all[1]!, all[2]!, all[0]!],
    [all[2]!, all[0]!, all[1]!],
    [all[2]!, all[1]!, all[0]!],
  ];
  const url = "https://example.com/rules";
  const id = surge.ruleSet({ url, sources: all }).id;
  for (const sources of permutations) {
    const remote = surge.ruleSet({ url, sources });
    assert.equal(remote.id, id);
    assert.deepEqual(remote.sources, sources);
    assert.ok(
      program([
        surge.ruleSet({ id: "shared", url, sources: all }),
        surge.ruleSet({ id: "shared", url, sources }),
      ]).ok,
    );
    assert.ok(
      program([
        ruleSet({ id: "named", when: match.domain("example.com", { sources: all }) }),
        ruleSet({ id: "named", when: match.domain("example.com", { sources }) }),
      ]).ok,
    );
  }
  assert.equal(surge.ruleSet({ url }).id, surge.ruleSet({ url, sources: ["destination"] }).id);
  assert.ok(
    program([
      surge.ruleSet({ id: "shared", url }),
      surge.ruleSet({ id: "shared", url, sources: ["destination"] }),
    ]).ok,
  );
  assert.ok(
    program([
      ruleSet({ id: "named", when: match.domain("example.com") }),
      ruleSet({ id: "named", when: match.domain("example.com", { sources: ["destination"] }) }),
    ]).ok,
  );
  assert.ok(
    program([
      surge.ruleSet({ id: "shared", url, sources: all }),
      surge.ruleSet({ id: "shared", url, sources: ["destination"] }),
    ]).diagnostics.some((d) => d.code === "RULESET_ID_CONFLICT"),
  );
  assert.notEqual(surge.ruleSet({ url }).id, surge.ruleSet({ url, noResolve: false }).id);
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("source constructors snapshot arrays and reject legacy or invalid inputs", () => {
  const sources = [...all];
  const atom = match.domain("example.com", { sources });
  sources.reverse();
  assert.deepEqual(atom.sources, all);
  for (const invalid of [
    [],
    ["destination", "destination"],
    ["unknown"],
    ["destination", "tlsSni", "httpHost", "destination"],
  ]) {
    assert.throws(() => match.domain("example.com", { sources: invalid } as never));
    const raw = { type: "domain", value: "example.com", sources: invalid } as Match;
    assert.equal(program([raw]).ok, false);
    assert.equal(
      compileProfile({ ...base, routes: [defineRoute({ when: raw, to: outbound.direct })] }).ok,
      false,
    );
  }
  assert.throws(() => match.domain("example.com", { extendedMatching: true } as never));
  assert.equal(
    program([{ type: "domain", value: "example.com", extendedMatching: true } as never]).ok,
    false,
  );
  assert.equal(
    compileProfile({
      ...base,
      routes: [
        defineRoute({
          when: { type: "domain", value: "example.com", extendedMatching: true } as never,
          to: outbound.direct,
        }),
      ],
    }).ok,
    false,
  );
  assert.equal(
    program([{ type: "all", conditions: [match.domain("example.com")], sources: all } as never]).ok,
    false,
  );
  let reads = 0;
  const getters = Object.defineProperty([], 0, {
    enumerable: true,
    get() {
      reads++;
      return "destination";
    },
  });
  assert.throws(() => match.domain("example.com", { sources: getters }));
  assert.equal(reads, 0);
});
