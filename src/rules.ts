// @concord-file
// @concord-implements docs/feature/rule-composition/README.md
import ipaddr from "ipaddr.js";
import { match } from "./dsl.js";
import { requestSchema } from "./schema.js";
import type {
  Action,
  ConditionTrace,
  Diagnostic,
  Entry,
  ExpandedRule,
  Explanation,
  Match,
  Network,
  Request,
  Slot,
} from "./types.js";

// @concord-code
// @concord-implements docs/feature/rule-composition/use-case/compose-policy.md
export function expandRules(
  entries: readonly Entry[],
  diagnostics: Diagnostic[],
  path = "routing",
): ExpandedRule[] {
  const output: ExpandedRule[] = [];
  const seen = new Set<string>();
  let limited = false;
  const error = (code: string, where: string, message: string) =>
    diagnostics.push({ severity: "error", code, path: where, message });
  function resolve(
    action: Action | Slot,
    bindings: Readonly<Record<string, Action>>,
    inPolicy: boolean,
    where: string,
  ): Action | undefined {
    if (action.type === "slot") {
      if (!Object.hasOwn(bindings, action.name)) {
        error("UNBOUND_SLOT", where, "出口槽位未声明或未绑定");
        return;
      }
      return bindings[action.name];
    }
    if (inPolicy && action.type === "route") {
      error("POLICY_RESOURCE_CAPTURE", where, "共享 policy 必须通过 slot 引用出口");
      return;
    }
    return action;
  }
  function walk(
    items: readonly Entry[],
    prefix: string,
    guards: readonly Match[],
    bindings: Readonly<Record<string, Action>>,
    inPolicy: boolean,
    origin: readonly string[],
  ): void {
    for (const entry of items) {
      if (limited) return;
      if (entry.type === "rule" && output.length >= 10000) {
        limited = true;
        error("EXPANSION_LIMIT", path, "展开规则超过10000条");
        return;
      }
      const id = `${prefix}/${entry.id}`;
      if (seen.has(id)) {
        error("DUPLICATE_RULE_ID", id, "同一实例路径出现重复 ID");
        continue;
      }
      seen.add(id);
      if (entry.type === "rule") {
        const action = resolve(entry.then, bindings, inPolicy, id);
        if (action)
          output.push({
            id,
            when: guards.length ? match.all(...guards, entry.when) : entry.when,
            then: action,
            origin: [...origin, entry.id],
          });
      } else if (entry.type === "block") {
        walk(entry.rules, id, entry.when ? [...guards, entry.when] : guards, bindings, inPolicy, [
          ...origin,
          entry.id,
        ]);
      } else {
        const expected = new Set(entry.policy.exits);
        if (
          Object.keys(entry.bindings).some((key) => !expected.has(key)) ||
          entry.policy.exits.some((key) => !Object.hasOwn(entry.bindings, key))
        ) {
          error("POLICY_BINDINGS", id, "bindings 必须完整且只包含 policy 声明的出口");
          continue;
        }
        const bound: Record<string, Action> = Object.create(null);
        for (const key of entry.policy.exits) {
          const result = resolve(entry.bindings[key]!, bindings, inPolicy, `${id}/bindings/${key}`);
          if (result) bound[key] = result;
        }
        walk(entry.policy.rules, id, guards, bound, true, [
          ...origin,
          `use:${entry.id}`,
          `policy:${entry.policy.id}`,
        ]);
      }
    }
  }
  walk(entries, path, [], {}, false, []);
  return limited ? [] : output;
}

function inCidr(address: string | undefined, cidr: string): boolean {
  if (!address) return false;
  const parsed = ipaddr.parse(address);
  const [base, bits] = ipaddr.parseCIDR(
    cidr.includes("/") ? cidr : `${cidr}/${cidr.includes(":") ? 128 : 32}`,
  );
  return parsed.kind() === base.kind() && parsed.match(base, bits);
}

export class StaticRuleSetUnknownError extends Error {
  constructor() {
    super("STATIC_RULESET_UNKNOWN");
    this.name = "StaticRuleSetUnknownError";
  }
}
export function evaluate(condition: Match, request: Request): ConditionTrace {
  if (condition.type === "ruleSet") return evaluate(condition.when, request);
  if (condition.type === "nativeRuleSet")
    return { type: condition.type, matched: null, reason: "外部规则内容由客户端解释，静态未知" };
  if (condition.type === "all" || condition.type === "any") {
    const children = condition.conditions.map((child) => evaluate(child, request));
    const matched =
      condition.type === "all"
        ? children.some((child) => child.matched === false)
          ? false
          : children.some((child) => child.matched === null)
            ? null
            : true
        : children.some((child) => child.matched === true)
          ? true
          : children.some((child) => child.matched === null)
            ? null
            : false;
    return {
      type: condition.type,
      matched,
      reason: condition.type === "all" ? "所有子条件同时成立" : "至少一个子条件成立",
      children,
    };
  }
  if (condition.type === "not") {
    const child = evaluate(condition.condition, request);
    return {
      type: "not",
      matched: child.matched === null ? null : !child.matched,
      reason: "布尔取反；缺失字段的原子条件为 false",
      children: [child],
    };
  }
  let matched: boolean;
  let present: boolean;
  switch (condition.type) {
    case "domain":
      present = request.domain !== undefined;
      matched = request.domain === condition.value;
      break;
    case "domainSuffix":
      present = request.domain !== undefined;
      matched =
        request.domain === condition.value || !!request.domain?.endsWith(`.${condition.value}`);
      break;
    case "ipCidr":
      present = request.ip !== undefined;
      matched = inCidr(request.ip, condition.value);
      break;
    case "processName":
      present = request.processName !== undefined;
      matched = request.processName === condition.value;
      break;
    case "sourceIp":
      present = request.sourceIp !== undefined;
      matched = inCidr(request.sourceIp, condition.value);
      break;
    case "port":
      present = request.port !== undefined;
      matched = present && request.port! >= condition.from && request.port! <= condition.to;
      break;
    case "sourcePort":
      present = request.sourcePort !== undefined;
      matched =
        present && request.sourcePort! >= condition.from && request.sourcePort! <= condition.to;
      break;
    case "network":
      present = true;
      matched = request.network === condition.value;
      break;
  }
  return {
    type: condition.type,
    matched,
    reason: present ? (matched ? "匹配" : "不匹配") : "字段缺失，原子条件为 false",
  };
}

// @concord-code
// @concord-implements docs/feature/policy-explanation/use-case/protect-routing.md
export function explainRules(
  rules: readonly ExpandedRule[],
  fallback: Action,
  input: Request,
): Explanation {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_REQUEST");
  const trace: { id: string; origin: readonly string[]; condition: ConditionTrace }[] = [];
  for (const rule of rules) {
    const condition = evaluate(rule.when, parsed.data);
    trace.push({ id: rule.id, origin: rule.origin, condition });
    if (condition.matched === null) throw new StaticRuleSetUnknownError();
    if (condition.matched) return { mode: "static", rule: rule.id, action: rule.then, trace };
  }
  return { mode: "static", rule: "$fallback", action: fallback, trace };
}

/** Over-approximation of possible truth values, never a proof from unobserved metadata. */
export function truthPossibilities(condition: Match, network: Network): readonly boolean[] {
  switch (condition.type) {
    case "ruleSet":
      return truthPossibilities(condition.when, network);
    case "network":
      return [condition.value === network];
    case "not":
      return truthPossibilities(condition.condition, network).map((v) => !v);
    case "all": {
      const sets = condition.conditions.map((c) => truthPossibilities(c, network));
      return [
        ...(sets.every((s) => s.includes(true)) ? [true] : []),
        ...(sets.some((s) => s.includes(false)) ? [false] : []),
      ];
    }
    case "any": {
      const sets = condition.conditions.map((c) => truthPossibilities(c, network));
      return [
        ...(sets.some((s) => s.includes(true)) ? [true] : []),
        ...(sets.every((s) => s.includes(false)) ? [false] : []),
      ];
    }
    default:
      return [false, true];
  }
}
export function logicalDepth(condition: Match): number {
  if (condition.type === "ruleSet") return logicalDepth(condition.when);
  if (condition.type === "all" || condition.type === "any")
    return 1 + Math.max(...condition.conditions.map(logicalDepth));
  if (condition.type === "not") return 1 + logicalDepth(condition.condition);
  return 0;
}
