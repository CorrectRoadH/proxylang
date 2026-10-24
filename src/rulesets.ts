// @concord-file
// @concord-implements docs/feature/rule-composition/use-case/compose-native-rule-sets.md
import { domainIdentityFields } from "./match-identity.js";
import type {
  Diagnostic,
  Entry,
  Match,
  Engine,
  ExpandedRule,
  NativeRuleSet,
  Target,
} from "./types.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${domainIdentityFields(value)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function validateRuleSets(
  entries: readonly Entry[],
  engine: Engine,
  diagnostics: Diagnostic[],
  path: string,
): void {
  const definitions = new Map<string, string>();
  const urls = new Map<string, string>();
  const error = (code: string) =>
    diagnostics.push({
      severity: "error",
      code,
      path,
      message: "原生规则集引擎不匹配或相同 ID/URL 的定义冲突",
    });
  const visit = (m: Match): void => {
    if (m.type === "ruleSet" || m.type === "nativeRuleSet") {
      const key = canonical(m);
      if (definitions.has(m.id) && definitions.get(m.id) !== key) error("RULESET_ID_CONFLICT");
      definitions.set(m.id, key);
      if (m.type === "ruleSet") visit(m.when);
      else {
        if (m.engine !== engine) error("NATIVE_TARGET_MISMATCH");
        if (m.engine === "surge") {
          const settings = canonical([m.format, m.intervalSeconds ?? 86400]);
          const url = new URL(m.url).href;
          if (urls.has(url) && urls.get(url) !== settings) error("RULESET_URL_CONFLICT");
          urls.set(url, settings);
        }
      }
    } else if (m.type === "all" || m.type === "any") m.conditions.forEach(visit);
    else if (m.type === "not") visit(m.condition);
  };
  const walk = (items: readonly Entry[]): void => {
    for (const item of items) {
      if (item.type === "rule") visit(item.when);
      else if (item.type === "block") {
        if (item.when) visit(item.when);
        walk(item.rules);
      } else walk(item.policy.rules);
    }
  };
  walk(entries);
}
export function lowerRuleSets(
  rules: readonly ExpandedRule[],
  diagnostics: Diagnostic[],
  path: string,
): ExpandedRule[] {
  let count = 0;
  let origins = 0;
  const lower = (m: Match, origin: string[], depth: number): Match => {
    if (++count > 100000 || depth > 64) throw new Error("EXPANSION_LIMIT");
    if (m.type === "ruleSet") {
      origin.push(`rule-set:${m.id}`);
      return lower(m.when, origin, depth + 1);
    }
    if (m.type === "all" || m.type === "any")
      return { ...m, conditions: m.conditions.map((c) => lower(c, origin, depth + 1)) };
    if (m.type === "not") return { ...m, condition: lower(m.condition, origin, depth + 1) };
    return m;
  };
  try {
    if (rules.length > 10000) throw new Error("EXPANSION_LIMIT");
    return rules.map((r) => {
      const origin = [...r.origin];
      const when = lower(r.when, origin, 0);
      origins += origin.length;
      if (origins > 100000) throw new Error("EXPANSION_LIMIT");
      return { ...r, when, origin };
    });
  } catch {
    diagnostics.push({
      severity: "error",
      code: "EXPANSION_LIMIT",
      path,
      message: "展开规则、条件或来源超过预算",
    });
    return [];
  }
}
export function collectNativeRuleSets(
  rules: readonly ExpandedRule[],
  target: Target,
  diagnostics: Diagnostic[],
): NativeRuleSet[] {
  const found = new Map<string, NativeRuleSet>();
  const visit = (m: Match, nested: boolean): void => {
    if (m.type === "nativeRuleSet") {
      found.set(m.id, m);
      if (nested && m.engine === "surge" && m.intervalSeconds !== undefined)
        diagnostics.push({
          severity: "error",
          code: "RULESET_COMPOSITION_UNSUPPORTED",
          target: target.id,
          path: `targets.${target.id}.ruleSets.${m.id}`,
          message: "Surge 嵌套外部规则只支持客户端默认更新间隔",
        });
    } else if (m.type === "all" || m.type === "any") m.conditions.forEach((c) => visit(c, true));
    else if (m.type === "not") visit(m.condition, true);
    else if (m.type === "ruleSet") visit(m.when, nested);
  };
  rules.forEach((r) => visit(r.when, false));
  for (const r of found.values())
    diagnostics.push({
      severity: "warning",
      code: "EXTERNAL_RULESET_UNVERIFIED",
      target: target.id,
      path: `targets.${target.id}.ruleSets.${r.id}`,
      message: "外部规则由客户端更新和解释；编译器未获取内容或验证运行时匹配",
    });
  return [...found.values()];
}
