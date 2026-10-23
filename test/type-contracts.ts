// @use-case docs/feature/rule-composition/use-case/compose-policy.md
import {
  defineProxyGroup,
  defineRoute,
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

defineProxyGroup({
  id: "typed",
  name: "Typed",
  algorithm: group.select(),
  members: [outbound.direct],
});
// @ts-expect-error destinations are objects, not string IDs
defineRoute({ id: "bad", when: surge.match.domain("example.com"), to: "typed" });
// @ts-expect-error native groups do not silently lower unsupported algorithms
defineProxyGroup({ id: "bad", name: "Bad", algorithm: group.auto(), members: [] });
