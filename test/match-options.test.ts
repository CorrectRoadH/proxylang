import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  compile,
  compileProfile,
  defineProfile,
  defineRoute,
  match,
  outbound,
  surge,
  mihomo,
  singbox,
  ruleSet,
  rule,
  direct,
  render,
  renderSurgeProfile,
  type ProfileCondition,
} from "../src/index.js";
import { evaluate } from "../src/rules.js";
import { fixture, trojan } from "./fixtures.js";
const base = {
  target: { engine: "surge", platform: "macos", version: "6.10.0" } as const,
  proxies: [],
  groups: [],
  routes: [],
  fallback: outbound.direct,
};
function profileText(when: ProfileCondition) {
  const result = compileProfile({ ...base, routes: [defineRoute({ when, to: outbound.direct })] });
  assert.ok(result.ok && result.engine === "surge", JSON.stringify(result));
  return renderSurgeProfile(result.compilation, () => "unused").content;
}
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("extended matching uses each observed source without overriding destination", () => {
  const condition = match.domainSuffix("example.com", { extendedMatching: true });
  for (const request of [
    { domain: "other.net", tlsSni: "sub.example.com" },
    { domain: "other.net", httpHost: "example.com" },
    { domain: "example.com", tlsSni: "other.net" },
  ]) {
    assert.equal(evaluate(condition, { network: "tcp", ...request }).matched, true);
    assert.equal(evaluate(match.not(condition), { network: "tcp", ...request }).matched, false);
  }
  assert.equal(evaluate(condition, { network: "tcp" }).matched, false);
  assert.equal(
    evaluate(match.domain("example.com"), { network: "tcp", tlsSni: "example.com" }).matched,
    false,
  );
  assert.equal(
    evaluate(match.domain("example.com", { extendedMatching: false }), {
      network: "tcp",
      httpHost: "example.com",
    }).matched,
    false,
  );
  for (const when of [
    condition,
    match.not(ruleSet({ id: "named", when: condition })),
    match.ipCidr("2001:db8::/32", { noResolve: false }),
  ]) {
    const result = compile(fixture([rule("test", when, direct())]));
    assert.ok(result.diagnostics.some((d) => d.code === "MATCH_OPTION_UNSUPPORTED"));
  }
  assert.match(profileText(condition), /DOMAIN-SUFFIX,example.com,DIRECT,extended-matching/);
  assert.match(
    profileText(match.all(condition, match.port(443))),
    /\(DOMAIN-SUFFIX,example.com,extended-matching\)/,
  );
});
// @use-case docs/feature/target-compilation/use-case/build-targets.md
test("CIDR preserves entry-specific defaults and explicit false on both address families", () => {
  for (const value of ["192.0.2.0/24", "2001:db8::/32"]) {
    for (const noResolve of [undefined, false, true]) {
      const when = match.ipCidr(value, noResolve === undefined ? {} : { noResolve });
      const text = profileText(when);
      assert.equal(text.includes(`${value},DIRECT,no-resolve`), noResolve === true);
      const config = fixture([rule("test", when, direct())], { engine: "surge" });
      const result = compile({
        ...config,
        targets: [{ id: "mac", program: "home", ...base.target }],
      });
      assert.ok(result.ok);
      assert.equal(
        render(result, () => "unused")[0]!.content.includes(`${value},DIRECT,no-resolve`),
        noResolve !== false,
      );
    }
  }
  assert.throws(() => match.domain("example.com", { noResolve: true } as never));
  let reads = 0;
  assert.throws(() =>
    match.ipCidr("192.0.2.0/24", {
      get noResolve() {
        reads++;
        return true;
      },
    }),
  );
  assert.equal(reads, 0);
});
// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
test("engine functions bind routes directly and retain snapshots and resource identity", () => {
  const input = { url: "https://example.com/rules", extendedMatching: true };
  const condition = surge.ruleSet(input);
  const route = surge.ruleSet({ ...input, to: outbound.direct });
  assert.deepEqual(route.when, condition);
  assert.equal(route.to, outbound.direct);
  const viaProxy = surge.ruleSet({ url: input.url, to: trojan });
  assert.equal(viaProxy.to, trojan);
  assert.ok(compileProfile({ ...base, proxies: [trojan], routes: [viaProxy] }).ok);
  assert.equal(
    compileProfile({
      ...base,
      proxies: [trojan],
      routes: [surge.ruleSet({ url: input.url, to: { ...trojan } })],
    }).ok,
    false,
  );
  input.url = "https://example.com/changed";
  assert.equal(condition.url, "https://example.com/rules");
  assert.equal(condition.id, surge.ruleSet({ extendedMatching: true, url: condition.url }).id);
  assert.ok(compileProfile({ ...base, routes: [route] }).ok);
  assert.equal(mihomo.ruleProvider, mihomo.ruleSet);
  assert.equal(
    mihomo.ruleSet({ url: condition.url, format: "yaml", behavior: "domain", intervalSeconds: 60 })
      .engine,
    "mihomo",
  );
  assert.equal(
    singbox.ruleSet({ url: condition.url, format: "binary", intervalSeconds: 60 }).engine,
    "sing-box",
  );
  assert.throws(() => surge.ruleSet({ url: condition.url, behavior: "domain" } as never));
  assert.throws(() => surge.ruleSet({ url: condition.url, to: undefined } as never));
  assert.throws(() => surge.ruleSet({ url: "x".repeat(3000) }));
  let reads = 0;
  assert.throws(() =>
    surge.ruleSet({
      get url() {
        reads++;
        return condition.url;
      },
    }),
  );
  assert.equal(reads, 0);
  const shared = Array(100001).fill(outbound.direct);
  const group = {
    type: "proxy-group",
    id: "group",
    name: "group",
    algorithm: { type: "select" },
    members: Array(101).fill(shared),
  };
  assert.throws(() => surge.ruleSet({ url: condition.url, to: group } as never));
  assert.ok(Object.isFrozen(defineProfile({ ...base, routes: [route] }).routes));
});
// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
test("Surge interval is top-level only and URL conflicts use effective interval", () => {
  const condition = surge.ruleSet({ url: "https://EXAMPLE.com/rules", intervalSeconds: 60 });
  assert.match(profileText(ruleSet({ id: "named", when: condition })), /DIRECT,update-interval=60/);
  for (const when of [match.all(condition), match.any(condition), match.not(condition)]) {
    assert.equal(
      compileProfile({ ...base, routes: [defineRoute({ when, to: outbound.direct })] }).ok,
      false,
    );
  }
  const other = surge.ruleSet({ url: "https://example.com/rules", to: outbound.direct });
  assert.equal(
    compileProfile({
      ...base,
      routes: [defineRoute({ when: condition, to: outbound.direct }), other],
    }).ok,
    false,
  );
  assert.ok(
    compileProfile({
      ...base,
      routes: [
        other,
        surge.ruleSet({
          url: "https://EXAMPLE.com/rules",
          intervalSeconds: 86400,
          to: outbound.direct,
        }),
      ],
    }).ok,
  );
});
