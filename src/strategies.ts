// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/strategy-implementations.md
import { stringify } from "yaml";
import { clashGroup } from "./clash.js";
import { z } from "zod";
import { assertData, deepFreeze, idSchema, strategySchema } from "./schema.js";
import { targetCatalog } from "./targets.js";
import type {
  ConcreteGroup,
  Diagnostic,
  Engine,
  Group,
  Strategy,
  StrategySelection,
} from "./types.js";

export function lowerStrategies(
  groups: readonly Group[],
  engine: Engine,
  diagnostics: Diagnostic[],
  path: string,
): { groups: ConcreteGroup[]; selections: StrategySelection[] } {
  const selected: ConcreteGroup[] = [];
  const selections: StrategySelection[] = [];
  for (const group of groups) {
    if (group.type !== "strategy") {
      selected.push(group);
      continue;
    }
    const algorithm = group.implementations[engine];
    const code = !algorithm
      ? "STRATEGY_IMPLEMENTATION_MISSING"
      : algorithm.type === "surge-smart" && engine !== "surge"
        ? "ALGORITHM_ENGINE_MISMATCH"
        : undefined;
    if (code) {
      diagnostics.push({
        severity: "error",
        code,
        path: `${path}.groups.${group.id}`,
        message: "策略没有目标实现或所选算法属于其它引擎",
      });
      continue;
    }
    selected.push({ id: group.id, members: group.members, ...algorithm! });
    selections.push({ id: group.id, engine, algorithm: algorithm!, members: group.members });
  }
  return { groups: selected, selections };
}

export function validateSmartMembers(
  groups: readonly ConcreteGroup[],
  nodes: ReadonlySet<string>,
  diagnostics: Diagnostic[],
  path: string,
): void {
  for (const group of groups)
    if (group.type === "surge-smart" && group.members.some((member) => !nodes.has(member))) {
      diagnostics.push({
        severity: "error",
        code: "SMART_MEMBER_UNSUPPORTED",
        path: `${path}.groups.${group.id}`,
        message: "Surge Smart 成员只能是节点，不能是组或内建动作",
      });
    }
}

// Codecs are shared by full configuration rendering and the explicitly partial group artifact.
export function surgeGroup(
  group: ConcreteGroup,
  name: (id: string) => string = (id) => id,
): string {
  if (group.type !== "select" && group.type !== "surge-smart") throw new Error("GROUP_UNSUPPORTED");
  return `${name(group.id)} = ${group.type === "surge-smart" ? "smart" : "select"}, ${group.members.map(name).join(", ")}`;
}
export function singboxGroup(
  group: ConcreteGroup,
  name: (id: string) => string = (id) => id,
): Record<string, string | number | boolean | string[]> {
  if (group.type !== "select" && group.type !== "urltest") throw new Error("GROUP_UNSUPPORTED");
  return group.type === "select"
    ? {
        type: "selector",
        tag: name(group.id),
        outbounds: group.members.map(name),
        default: name(group.members[0]!),
        interrupt_exist_connections: false,
      }
    : {
        type: "urltest",
        tag: name(group.id),
        outbounds: group.members.map(name),
        url: group.url,
        interval: `${group.intervalSeconds ?? 180}s`,
        tolerance: group.toleranceMs ?? 50,
        idle_timeout: "30m",
        interrupt_exist_connections: false,
      };
}

export type StrategyGroupInput = {
  readonly target: {
    readonly engine: Engine;
    readonly platform: "macos" | "linux";
    readonly version: string;
  };
  readonly nodes: readonly { readonly id: string; readonly nativeName: string }[];
  readonly strategies: readonly Strategy[];
  readonly names?: Readonly<Record<string, string>>;
};
export type StrategyGroupCompilation = {
  readonly ok: boolean;
  readonly artifactKind: "strategy-groups";
  readonly diagnostics: readonly Diagnostic[];
  readonly selections: readonly StrategySelection[];
  readonly content: string | null;
};
const nameSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      value.trim() === value &&
      !/[\p{C}\p{Zl}\p{Zp},=[\]()#;]/u.test(value) &&
      !["DIRECT", "REJECT"].includes(value.toUpperCase()) &&
      !value.toLowerCase().startsWith("pl-"),
  );
const inputSchema: z.ZodType<StrategyGroupInput> = z.strictObject({
  target: z.strictObject({
    engine: z.enum(["surge", "sing-box", "mihomo", "stash"]),
    platform: z.enum(["macos", "linux"]),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
  }),
  nodes: z.array(z.strictObject({ id: idSchema, nativeName: nameSchema })).max(1000),
  strategies: z.array(strategySchema).max(1000),
  names: z.record(idSchema, nameSchema).optional(),
});
/** Only group topology/encoding is checked here; nodes, via, protocols and routes remain consumer-owned. */
export function compileStrategyGroups(input: unknown): StrategyGroupCompilation {
  const diagnostics: Diagnostic[] = [];
  const error = (code: string, path: string, message: string) =>
    diagnostics.push({ severity: "error", code, path, message });
  const failure = (): StrategyGroupCompilation =>
    deepFreeze({
      ok: false,
      artifactKind: "strategy-groups",
      diagnostics,
      selections: [],
      content: null,
    });
  try {
    assertData(input);
  } catch {
    error("INVALID_INPUT_GRAPH", "$", "输入不是有限的声明数据");
    return failure();
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    error("INVALID_SCHEMA", "$", "策略目录、名字或目标不符合严格 schema");
    return failure();
  }
  const { target, nodes, strategies, names = {} } = parsed.data;
  const descriptor = targetCatalog.find(
    (d) =>
      d.engine === target.engine &&
      d.version === target.version &&
      (d.platforms as readonly string[]).includes(target.platform),
  );
  if (!descriptor) {
    error("UNKNOWN_TARGET", "target", "引擎、平台与精确版本不在支持目录");
    return failure();
  }
  const ids = [...nodes.map((n) => n.id), ...strategies.map((s) => s.id)];
  if (new Set(ids).size !== ids.length || ids.length > 1000)
    error("DUPLICATE_RESOURCE", "$", "资源 ID 必须唯一且总数不超过 1000");
  if (Object.keys(names).some((id) => !strategies.some((s) => s.id === id)))
    error("UNKNOWN_NAME_MAPPING", "names", "只能映射已声明策略 ID");
  const nativeNames = new Map([
    ...nodes.map((n) => [n.id, n.nativeName] as const),
    ...strategies.map((s) => [s.id, names[s.id] ?? s.id] as const),
  ]);
  if ([...nativeNames.values()].some((name) => !nameSchema.safeParse(name).success))
    error("INVALID_NATIVE_NAME", "names", "最终名称不符合原生名称约束");
  const reserved =
    target.engine === "mihomo"
      ? ["GLOBAL", "PASS", "COMPATIBLE", "REJECT-DROP", "PASS-RULE"]
      : target.engine === "stash"
        ? ["GLOBAL", "PASS", "COMPATIBLE", "REJECT-DROP"]
        : [];
  if ([...nativeNames.values()].some((value) => reserved.includes(value.toUpperCase())))
    error("INVALID_NATIVE_NAME", "names", "最终名称与目标内建策略冲突");
  if (new Set(nativeNames.values()).size !== nativeNames.size)
    error("DUPLICATE_NATIVE_NAME", "names", "最终节点和策略名称必须唯一");
  const { groups, selections } = lowerStrategies(strategies, target.engine, diagnostics, "$");
  const all = new Set(ids);
  for (const g of groups) {
    if (!(descriptor.groups as readonly string[]).includes(g.type))
      error("GROUP_UNSUPPORTED", `strategies.${g.id}`, "目标后端不能保持此算法的参数语义");
    for (const member of g.members)
      if (!all.has(member))
        error("MISSING_REFERENCE", `strategies.${g.id}`, "成员不在节点或策略目录中");
  }
  const byId = new Map(groups.map((g) => [g.id, g]));
  const state = new Map<string, number>();
  const visit = (id: string): void => {
    if (state.get(id) === 1) {
      error("RESOURCE_CYCLE", `strategies.${id}`, "组依赖形成循环");
      return;
    }
    if (state.get(id) === 2) return;
    state.set(id, 1);
    for (const member of byId.get(id)?.members ?? []) visit(member);
    state.set(id, 2);
  };
  if (ids.length <= 1000) for (const id of byId.keys()) visit(id);
  validateSmartMembers(groups, new Set(nodes.map((n) => n.id)), diagnostics, "$");
  if (diagnostics.length) return failure();
  const name = (id: string) => nativeNames.get(id)!;
  const content =
    target.engine === "surge"
      ? groups.map((g) => surgeGroup(g, name)).join("\n") + "\n"
      : target.engine === "mihomo" || target.engine === "stash"
        ? stringify({ "proxy-groups": groups.map((g) => clashGroup(g, name)) })
        : JSON.stringify(
            groups.map((g) => singboxGroup(g, name)),
            null,
            2,
          ) + "\n";
  return deepFreeze({
    ok: true,
    artifactKind: "strategy-groups",
    diagnostics,
    selections,
    content,
  });
}
