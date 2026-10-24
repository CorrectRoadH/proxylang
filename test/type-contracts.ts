// @use-case docs/feature/rule-composition/use-case/compose-policy.md
import {
  defineProfile,
  type ProfileCondition,
  type GroupAlgorithm,
  type ProxyGroupDefinition,
  type RouteDefinition,
  defineProxyGroup,
  defineRoute,
  defineRoutes,
  defineBuild,
  runBuild,
  outbound,
  block,
  strategy,
  group,
  surge,
  defineConfig,
  direct,
  match,
  policy,
  route,
  rule,
  sequence,
  slot,
  use,
  type Config,
  type Entry,
  type Program,
  type Target,
} from "../src/index.js";

// Checked by tsc and again against the installed tarball; never executed.
export function authoringTypeChecks(dynamicConfig: Config, dynamicRules: Entry[]) {
  const work = policy({
    id: "work",
    exits: ["proxy"],
    rules: sequence(
      rule("local", match.domain("local.example"), direct()),
      block("tcp", [rule("web", match.port(443), slot("proxy"))], match.network("tcp")),
    ),
  });
  use(work, { id: "office", bindings: { proxy: route("edge") } });
  // @ts-expect-error A required binding cannot be omitted.
  use(work, { id: "missing", bindings: {} });
  const extraBindings = { proxy: direct(), typo: direct() };
  // @ts-expect-error Extra keys are rejected even through a variable.
  use(work, { id: "extra", bindings: extraBindings });
  const typo = sequence(block("nested", [rule("web", match.port(443), slot("porxy"))]));
  // @ts-expect-error Rules cannot widen the set of declared exits.
  policy({ id: "typo", exits: ["proxy"], rules: typo });
  const forwarded = use(work, { id: "child", bindings: { proxy: slot("outer") } });
  policy({ id: "parent", exits: ["outer"], rules: [forwarded] });
  // @ts-expect-error Nested bindings must reference a declared outer exit.
  policy({ id: "parent", exits: ["other"], rules: [forwarded] });
  policy({ id: "local", exits: [], rules: [rule("lan", match.port(80), direct())] });
  // @ts-expect-error No exits means no slots.
  policy({ id: "empty", exits: [], rules: [rule("web", match.port(443), slot("proxy"))] });
  const dynamicExits: string[] = ["proxy"];
  policy({ id: "dynamic", exits: dynamicExits, rules: dynamicRules });
  policy({ id: "annotated", exits: ["proxy"], rules: dynamicRules });
  defineConfig(dynamicConfig);

  const home: Program = {
    engine: "sing-box",
    nodes: [],
    groups: [],
    routing: [],
    fallback: direct(),
  };
  const target = { id: "box", engine: "sing-box", platform: "linux", version: "1.12.0" } as const;
  const config = defineConfig({ programs: { home }, targets: [{ ...target, program: "home" }] });
  const name: "home" = config.targets[0].program;
  const dynamicTargets: Target[] = [{ ...target, program: "home" }];
  defineConfig({ programs: { home }, targets: dynamicTargets });
  defineConfig({ programs: { home }, targets: [{ ...target, program: name }] });
  // @ts-expect-error Target programs are constrained by actual program keys.
  defineConfig({ programs: { home }, targets: [{ ...target, program: "typo" }] });
  defineConfig({
    programs: { home },
    targets: [{ ...target, program: "home" }],
    // @ts-expect-error Case programs are constrained by actual program keys.
    cases: [
      { id: "bad", program: "typo", request: { network: "tcp" }, expect: { action: direct() } },
    ],
  });
}

// @use-case docs/feature/target-compilation/use-case/strategy-implementations.md
export function strategyTypeChecks() {
  strategy({ id: "auto", members: ["edge"], algorithm: group.auto() });
  strategy({ id: "manual", members: ["edge"], algorithm: group.select() });
  strategy({
    id: "probe",
    members: ["edge"],
    algorithm: group.urltest({ url: "https://example.com" }),
  });
  strategy({ id: "legacy", members: ["edge"], implementations: { surge: surge.smart() } });
  // @ts-expect-error A strategy must declare an algorithm or implementations.
  strategy({ id: "empty", members: ["edge"] });
  // @ts-expect-error A native Smart implementation is not a portable algorithm requirement.
  strategy({ id: "bad", members: ["edge"], algorithm: surge.smart() });
  // @ts-expect-error Auto is a requirement, not a concrete native implementation.
  strategy({ id: "bad", members: ["edge"], implementations: { surge: group.auto() } });
}

const typedGroup = defineProxyGroup({
  id: "typed",
  name: "Typed",
  algorithm: group.select(),
  members: [outbound.direct],
});
defineRoute({ when: surge.match.domain("example.com"), to: "typed" });
// @ts-expect-error native groups do not silently lower unsupported algorithms
defineProxyGroup({ id: "bad", name: "Bad", algorithm: group.auto(), members: [] });

const anonymous = defineRoute({ when: surge.match.domain("example.com"), to: outbound.direct });
defineRoutes({ when: [anonymous.when], to: outbound.direct });
// @ts-expect-error route identity is intentionally absent
defineRoute({ id: "removed", when: anonymous.when, to: outbound.direct });
const batch = defineBuild({
  profiles: {},
  secrets: (_token, context) => (context.validation ? "fixture" : undefined),
});
void runBuild(batch, "out", { validation: true });

export function profileTypeChecks() {
  const route: RouteDefinition = defineRoute({
    when: surge.match.domain("example.com"),
    to: outbound.direct,
  });
  const condition: ProfileCondition = route.when;
  const choice: ProxyGroupDefinition = defineProxyGroup({
    id: "choice",
    name: "Choice",
    algorithm: group.urltest({ url: "https://example.com", intervalSeconds: 300 }),
    members: [outbound.direct],
  });
  const algorithm: GroupAlgorithm = choice.algorithm;
  const profile = defineProfile({
    target: { engine: "sing-box", platform: "linux", version: "1.12.0" },
    proxies: [],
    groups: [],
    routes: defineRoutes({ when: [match.ipCidr("2001:db8::/32")], to: outbound.direct }),
    fallback: outbound.direct,
  });
  // @ts-expect-error Profile nested arrays are immutable.
  profile.proxies.push({});
  // @ts-expect-error Target is immutable.
  profile.target.version = "1.11.0";
  return { condition, algorithm, profile };
}

export function compositionTypeChecks() {
  const profile = defineProfile({
    target: { engine: "surge", platform: "macos", version: "6.10.0" },
    proxies: [[], [[]]],
    groups: [[typedGroup]],
    routes: [[anonymous], []],
    fallback: "typed",
    surge: { general: [{ ipv6: true }, [{ loglevel: "notify" }]], hosts: [[], []] },
  });
  // @ts-expect-error Profile no longer has a separate nodes field.
  defineProfile({ ...profile, nodes: [] });
  // @ts-expect-error Profile no longer has a separate endpoints field.
  defineProfile({ ...profile, endpoints: [] });
  return profile;
}

export function nativeRouteTypeChecks() {
  const native = surge.ruleSet({ url: "https://example.com/rules" });
  const routed = surge.ruleSet({ url: native.url, to: outbound.direct });
  rule("portable", match.all(match.domain("example.com"), match.port(443)), direct());
  const mixed = match.all(surge.match.macAddress("00:11:22:33:44:55"), match.port(443));
  defineRoute({ when: mixed, to: outbound.direct });
  // @ts-expect-error Platform conditions cannot enter portable Program rules.
  rule("mac", mixed, direct());
  // @ts-expect-error A routed resource is not a condition.
  defineRoute({ when: routed, to: outbound.direct });
  defineProfile({
    target: { engine: "surge", platform: "macos", version: "6.10.0" },
    proxies: [],
    groups: [],
    // @ts-expect-error A resource without to is not a route.
    routes: [native],
    fallback: outbound.direct,
  });
  return routed;
}

export function sourceAndSecretTypes() {
  match.domain("example.com", { sources: ["destination", "tlsSni", "httpHost"] });
  // @ts-expect-error Retired boolean option is not a public input.
  match.domain("example.com", { extendedMatching: true });
  // @ts-expect-error Only named domain sources are accepted.
  match.domain("example.com", { sources: ["sniff"] });
  // @ts-expect-error CIDR has no domain sources.
  match.ipCidr("192.0.2.0/24", { sources: ["destination"] });
  // @ts-expect-error Retired callback field must fail at compile time too.
  defineBuild({ profiles: {}, resolveSecret: () => "old" });
}
