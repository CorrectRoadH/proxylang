// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/provider-nodes.md
import { z } from "zod";
import { assertData, deepFreeze, idSchema, nodeSchema } from "./schema.js";
import { nativeNameSchema, isReservedNativeName } from "./native-names.js";
import { RenderError, surgeProxy, validateProxyOptions } from "./proxies.js";
import { secretReader } from "./secrets.js";
import { targetCatalog } from "./targets.js";
import type { Diagnostic, ProxyNode, Secret } from "./types.js";

export type ProxyNodeInput = {
  readonly target: {
    readonly engine: "surge";
    readonly platform: "macos";
    readonly version: "6.10.0";
  };
  readonly nodes: readonly ProxyNode[];
  readonly names?: Readonly<Record<string, string>>;
  readonly externals?: readonly {
    readonly id: string;
    readonly nativeName: string;
    readonly kind: "proxy" | "group";
  }[];
};
export type ProxyNodeCompilation = {
  readonly ok: boolean;
  readonly artifactKind: "proxy-nodes";
  readonly diagnostics: readonly Diagnostic[];
  readonly bindings: readonly { readonly id: string; readonly nativeName: string }[];
  readonly requirements: readonly {
    readonly id: string;
    readonly nativeName: string;
    readonly kind: "proxy" | "group";
    readonly usedBy: readonly string[];
  }[];
};
export type ProxyNodeArtifact = {
  readonly artifactKind: "proxy-nodes";
  readonly content: string;
  readonly entries: readonly { readonly id: string; readonly content: string }[];
};
const inputSchema = z.strictObject({
  target: z.strictObject({ engine: z.string(), platform: z.string(), version: z.string() }),
  nodes: z.array(nodeSchema).max(1000),
  names: z.record(idSchema, nativeNameSchema).optional(),
  externals: z
    .array(
      z.strictObject({
        id: idSchema,
        nativeName: nativeNameSchema,
        kind: z.enum(["proxy", "group"]),
      }),
    )
    .max(1000)
    .optional(),
});
type Plan = {
  readonly nodes: readonly ProxyNode[];
  readonly names: Readonly<Record<string, string>>;
};
const plans = new WeakMap<ProxyNodeCompilation, Plan>();

export function compileProxyNodes(input: unknown): ProxyNodeCompilation {
  const diagnostics: Diagnostic[] = [];
  const error = (code: string, path: string, message: string) =>
    diagnostics.push({ severity: "error", code, path, message });
  const failure = (): ProxyNodeCompilation =>
    deepFreeze({
      ok: false,
      artifactKind: "proxy-nodes",
      diagnostics,
      bindings: [],
      requirements: [],
    });
  try {
    assertData(input);
  } catch {
    error("INVALID_INPUT_GRAPH", "$", "输入必须是有限纯数据，不接受 builder 或访问器");
    return failure();
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    error("INVALID_SCHEMA", "$", "节点、名字或外部声明不符合严格 schema");
    return failure();
  }
  const { target, nodes, names = {}, externals = [] } = deepFreeze(parsed.data);
  const ids = [...nodes.map((n) => n.id), ...externals.map((e) => e.id)];
  if (ids.length > 1000) error("RESOURCE_LIMIT", "$", "节点和外部声明总数最多1000");
  if (new Set(ids).size !== ids.length)
    error("DUPLICATE_RESOURCE", "$", "节点与外部声明 ID 必须唯一");
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (Object.keys(names).some((id) => !nodeIds.has(id)))
    error("UNKNOWN_NAME_MAPPING", "names", "名字映射只能引用输入节点");
  const bindings = nodes.map((node) => ({
    id: node.id,
    nativeName: Object.hasOwn(names, node.id) ? names[node.id]! : node.id,
  }));
  const symbols = [...bindings, ...externals];
  if (
    symbols.some(
      (s) =>
        !nativeNameSchema.safeParse(s.nativeName).success ||
        isReservedNativeName(s.nativeName, "surge"),
    )
  )
    error("INVALID_NATIVE_NAME", "names", "原生名不合法或与目标内建策略冲突");
  if (new Set(symbols.map((s) => s.nativeName)).size !== symbols.length)
    error("DUPLICATE_NATIVE_NAME", "names", "节点和外部符号的原生名必须唯一");
  const allIds = new Set(ids);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes)
    if (node.via && !allIds.has(node.via))
      error("MISSING_REFERENCE", `nodes.${node.id}.via`, "拨号依赖未声明");
  const states = new Map<string, number>();
  const visit = (id: string): void => {
    if (states.get(id) === 1) {
      error("RESOURCE_CYCLE", `nodes.${id}.via`, "内部拨号依赖形成循环");
      return;
    }
    if (states.get(id) === 2) return;
    states.set(id, 1);
    const via = byId.get(id)?.via;
    if (via && byId.has(via)) visit(via);
    states.set(id, 2);
  };
  if (ids.length <= 1000) for (const id of byId.keys()) visit(id);
  if (diagnostics.length) return failure();
  if (target.engine !== "surge" || target.platform !== "macos" || target.version !== "6.10.0") {
    error("UNKNOWN_TARGET", "target", "节点片段仅支持 Surge macOS 6.10.0");
    return failure();
  }
  const descriptor = targetCatalog.find(
    (t) => t.engine === "surge" && t.version === target.version,
  )!;
  for (const node of nodes) {
    if (!(descriptor.protocols as readonly string[]).includes(node.type))
      error("PROTOCOL_UNSUPPORTED", `nodes.${node.id}`, "精确目标不支持该节点协议");
    validateProxyOptions(
      node,
      {
        id: "nodes",
        program: "nodes",
        engine: "surge",
        platform: "macos",
        version: target.version,
      },
      diagnostics,
    );
  }
  if (diagnostics.some((d) => d.severity === "error")) return failure();
  const requirements = externals.flatMap((external) => {
    const usedBy = nodes.filter((node) => node.via === external.id).map((node) => node.id);
    return usedBy.length ? [{ ...external, usedBy }] : [];
  });
  if (requirements.length)
    diagnostics.push({
      severity: "warning",
      code: "EXTERNAL_REFERENCE_UNVERIFIED",
      path: "externals",
      message: "必须逐设备验证原生符号、include 闭包及完整依赖图；未知动态组须拒绝",
    });
  const compilation: ProxyNodeCompilation = deepFreeze({
    ok: true,
    artifactKind: "proxy-nodes",
    diagnostics,
    bindings,
    requirements,
  });
  plans.set(
    compilation,
    deepFreeze({ nodes, names: Object.fromEntries(symbols.map((s) => [s.id, s.nativeName])) }),
  );
  return compilation;
}

export function renderProxyNodes(
  compilation: ProxyNodeCompilation,
  resolveSecret: (token: Secret) => string | undefined,
): ProxyNodeArtifact {
  const plan = plans.get(compilation);
  if (!plan) throw new RenderError("COMPILATION_FAILED");
  const secret = secretReader(resolveSecret);
  const entries = plan.nodes.map((node) => ({
    id: node.id,
    content: surgeProxy(node, secret, (id) => plan.names[id]!) + "\n",
  }));
  return deepFreeze({
    artifactKind: "proxy-nodes",
    content: entries.map((e) => e.content).join(""),
    entries,
  });
}
