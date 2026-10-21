// @concord-file
// @concord-implements docs/feature/target-compilation/README.md
import { validateClashTarget } from "./clash.js";
import { assertData, configSchema, deepFreeze } from "./schema.js";
import { expandRules, explainRules, logicalDepth, truthPossibilities } from "./rules.js";
import type {
  Action,
  Config,
  Diagnostic,
  Entry,
  ExpandedRule,
  Explanation,
  Program,
  Request,
  Target,
  ConcreteGroup,
  StrategySelection,
} from "./types.js";

import { targetCatalog } from "./targets.js";
export { targetCatalog } from "./targets.js";
import { lowerStrategies, validateSmartMembers } from "./strategies.js";
export type TargetPlan = {
  readonly target: Target;
  readonly program: Omit<Program, "groups"> & { readonly groups: readonly ConcreteGroup[] };
  readonly strategySelections: readonly StrategySelection[];
  readonly rules: readonly ExpandedRule[];
  readonly sourceMap: readonly {
    readonly rule: string;
    readonly nativeIndex: number;
    readonly origin: readonly string[];
  }[];
  readonly preconditions: readonly string[];
  readonly nativeValidation: "not-run";
};
export type Compilation = {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly plans: readonly TargetPlan[];
  readonly cases: readonly {
    readonly id: string;
    readonly passed: boolean;
    readonly actual: { readonly rule: string; readonly action: Action };
  }[];
};
// @concord-code
// @concord-implements docs/feature/target-compilation/use-case/build-targets.md
export function compile(input: unknown): Compilation {
  const diagnostics: Diagnostic[] = [];
  const plans: TargetPlan[] = [];
  const cases: { id: string; passed: boolean; actual: { rule: string; action: Action } }[] = [];
  const error = (code: string, path: string, message: string, target?: string) =>
    diagnostics.push({ severity: "error", code, path, message, ...(target ? { target } : {}) });
  try {
    assertData(input);
  } catch {
    error(
      "INVALID_INPUT_GRAPH",
      "$",
      "配置必须是无循环的有限数据图（最多 64 层、100000 项），不得包含访问器或可执行值",
    );
    return deepFreeze({ ok: false, diagnostics, plans: [], cases });
  }
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 20))
      error(
        "INVALID_SCHEMA",
        issue.path.map(String).join(".") || "$",
        "字段、类型或值不符合语言契约；检查严格 schema（不回显输入值）",
      );
    return deepFreeze({ ok: false, diagnostics, plans: [], cases });
  }
  const config: Config = deepFreeze(parsed.data);
  const expanded = new Map<string, readonly ExpandedRule[]>();
  if (Object.keys(config.programs).length === 0)
    error("EMPTY_PROGRAMS", "programs", "至少需要一个程序");
  for (const [name, program] of Object.entries(config.programs)) {
    const path = `programs.${name}`;
    const rules = expandRules(program.routing, diagnostics, name);
    expanded.set(name, rules);
    const resources = [...program.nodes, ...program.groups];
    const byId = new Map(resources.map((resource) => [resource.id, resource]));
    if (byId.size !== resources.length)
      error("DUPLICATE_RESOURCE", path, "节点与组共用唯一 ID 命名空间");
    const edges = new Map(
      resources.map((resource) => [
        resource.id,
        "members" in resource ? resource.members : resource.via ? [resource.via] : [],
      ]),
    );
    for (const [id, refs] of edges)
      for (const ref of refs)
        if (!byId.has(ref)) error("MISSING_REFERENCE", `${path}.${id}`, "节点或组引用不存在");
    const states = new Map<string, number>();
    const tcpOnly = new Map<string, boolean>();
    const visit = (id: string): boolean => {
      if (states.get(id) === 1) {
        error("RESOURCE_CYCLE", `${path}.${id}`, "组成员和 via 拨号依赖不能形成循环");
        return true;
      }
      if (states.get(id) === 2) return tcpOnly.get(id) ?? false;
      states.set(id, 1);
      const item = byId.get(id);
      let limited = item?.type === "http" || item?.type === "anytls";
      for (const ref of edges.get(id) ?? []) limited = visit(ref) || limited;
      states.set(id, 2);
      tcpOnly.set(id, limited);
      return limited;
    };
    // Bound graph traversal independently of the nested input limit.
    if (resources.length > 1000) error("RESOURCE_LIMIT", path, "单程序最多 1000 个节点与组");
    else for (const id of byId.keys()) visit(id);
    const validateAction = (action: Action, where: string, udpPossible: boolean) => {
      if (action.type !== "route") return;
      if (!byId.has(action.to)) error("MISSING_REFERENCE", where, "路由出口不存在");
      else if (udpPossible && tcpOnly.get(action.to))
        error(
          "NETWORK_UNSUPPORTED",
          where,
          "出口的可选或 via 路径含 TCP-only 节点；请用 network(tcp) 限定规则，且不能用于 fallback",
        );
    };
    for (const rule of rules)
      validateAction(rule.then, rule.id, truthPossibilities(rule.when, "udp").includes(true));
    const validateBindings = (entries: readonly Entry[], prefix: string): void => {
      for (const entry of entries) {
        if (entry.type === "block") validateBindings(entry.rules, `${prefix}/${entry.id}`);
        if (entry.type === "use") {
          for (const [key, action] of Object.entries(entry.bindings))
            if (action.type !== "slot")
              validateAction(action, `${prefix}/${entry.id}/bindings/${key}`, false);
          validateBindings(entry.policy.rules, `${prefix}/${entry.id}`);
        }
      }
    };
    validateBindings(program.routing, name);
    validateAction(program.fallback, `${path}.fallback`, true);
  }
  const targetIds = new Set<string>();
  for (const target of config.targets) {
    const path = `targets.${target.id}`;
    if (targetIds.has(target.id)) error("DUPLICATE_TARGET", path, "构建目标 ID 重复");
    targetIds.add(target.id);
    const descriptor = targetCatalog.find(
      (item) =>
        item.engine === target.engine &&
        item.version === target.version &&
        (item.platforms as readonly string[]).includes(target.platform),
    );
    if (!descriptor) {
      error("UNKNOWN_TARGET", path, "目标引擎、精确版本和平台组合不在支持目录中", target.id);
      continue;
    }
    const originalProgram = config.programs[target.program];
    const lowered = lowerStrategies(
      originalProgram?.groups ?? [],
      target.engine,
      diagnostics,
      path,
    );
    const program = originalProgram ? { ...originalProgram, groups: lowered.groups } : undefined;
    if (!program) {
      error("MISSING_PROGRAM", path, "目标引用的程序不存在", target.id);
      continue;
    }
    if (program.engine !== target.engine)
      error("ENGINE_MISMATCH", path, "平台程序与目标引擎不一致", target.id);
    if (target.mode === "standalone" && !program.listener)
      error(
        "LISTENER_REQUIRED",
        path,
        "standalone 必须声明 loopback listener 与 IP DNS resolver",
        target.id,
      );
    if (target.mode !== "standalone" && program.listener)
      error(
        "UNUSED_LISTENER",
        path,
        "fragment 不能静默忽略 listener；请使用独立程序或 standalone 目标",
        target.id,
      );
    for (const node of program.nodes) {
      if (!(descriptor.protocols as readonly string[]).includes(node.type))
        error(
          "PROTOCOL_UNSUPPORTED",
          `${path}.nodes.${node.id}`,
          "目标版本不支持该代理协议",
          target.id,
        );
      if (node.label)
        diagnostics.push({
          severity: "warning",
          code: "LABEL_NOT_EMITTED",
          path: `${path}.nodes.${node.id}.label`,
          target: target.id,
          message: "原生节点使用稳定 ID；展示 label 不写入配置，不影响路由",
        });
    }
    for (const group of program.groups)
      if (!(descriptor.groups as readonly string[]).includes(group.type))
        error(
          "GROUP_UNSUPPORTED",
          `${path}.groups.${group.id}`,
          "目标未实现该组机制；不会自动替换为另一种组",
          target.id,
        );
    validateSmartMembers(
      program.groups,
      new Set(program.nodes.map((n) => n.id)),
      diagnostics,
      path,
    );
    const rules = expanded.get(target.program)!;
    if (target.engine === "mihomo" || target.engine === "stash")
      validateClashTarget(target, rules, diagnostics);
    if (target.engine === "surge")
      for (const rule of rules)
        if (logicalDepth(rule.when) > 10)
          error("LOGICAL_DEPTH", rule.id, "Surge 逻辑条件最多嵌套 10 层", target.id);
    plans.push({
      target,
      program,
      rules,
      strategySelections: lowered.selections,
      sourceMap: rules.map((rule, nativeIndex) => ({
        rule: rule.id,
        nativeIndex,
        origin: rule.origin,
      })),
      preconditions: [
        ...(target.engine === "stash"
          ? ["Stash 4.2.1 原生未验证；block-quic: off 按现行文档编码，历史版本 QUIC 行为未验证。"]
          : []),
        "规则只匹配已观测元数据；不自动嗅探或为了 IP 条件解析域名。",
        "节点 server 与 via 各跳必须是 IP；运行时组选择、代理连通性不由静态解释保证。",
        ...(target.mode !== "standalone"
          ? ["此配置是 fragment，组合方负责入口、直接 DNS 解析路径及 source/domain/IP 元数据来源。"]
          : ["仅本机 loopback 显式代理；不是 TUN 或 LAN 网关。DNS 上游固定直连。"]),
      ],
      nativeValidation: "not-run",
    });
  }
  const caseIds = new Set<string>();
  for (const test of config.cases ?? []) {
    if (caseIds.has(test.id)) error("DUPLICATE_CASE", `cases.${test.id}`, "案例 ID 重复");
    caseIds.add(test.id);
    const program = config.programs[test.program];
    if (!program) {
      error("MISSING_PROGRAM", `cases.${test.id}`, "案例引用的程序不存在");
      continue;
    }
    const actual = explainRules(expanded.get(test.program)!, program.fallback, test.request);
    const passed =
      (test.expect.rule === undefined || test.expect.rule === actual.rule) &&
      sameAction(test.expect.action, actual.action);
    cases.push({ id: test.id, passed, actual: { rule: actual.rule, action: actual.action } });
    if (!passed) error("CASE_FAILED", `cases.${test.id}`, "请求的首命中规则或逻辑出口不符合预期");
  }
  if (config.warningsAsErrors) {
    for (let i = 0; i < diagnostics.length; i++)
      if (diagnostics[i]!.severity === "warning")
        diagnostics[i] = { ...diagnostics[i]!, severity: "error" };
  }
  const ok = !diagnostics.some((d) => d.severity === "error");
  return deepFreeze({ ok, diagnostics, plans: ok ? plans : [], cases });
}
function sameAction(a: Action, b: Action): boolean {
  return a.type === b.type && (a.type !== "route" || (b.type === "route" && a.to === b.to));
}
// @concord-code
// @concord-implements docs/feature/policy-explanation/use-case/explain-request.md
export function explain(compilation: Compilation, target: string, request: Request): Explanation {
  if (!compilation.ok) throw new Error("COMPILATION_FAILED");
  const plan = compilation.plans.find((plan) => plan.target.id === target);
  if (!plan) throw new Error("UNKNOWN_TARGET");
  return explainRules(plan.rules, plan.program.fallback, request);
}
