// @concord-file
// @concord-implements docs/feature/targets/format/surge.md
import { assertData, deepFreeze } from "../../model/schema.js";
import {
  key,
  inputSchema,
  type SurgeProfileInput,
  type SurgeCondition,
  type SurgeGeneral,
  type SurgePolicy,
} from "../../model/surge-schema.js";
import { nativeNameSchema, isReservedNativeName } from "../../model/names.js";
import { RenderError } from "../../model/errors.js";
import { surgeProxy } from "./proxies.js";
import { validateProxyOptions } from "../../targets/proxies.js";
import type { Diagnostic, Secret } from "../../model/types.js";
export type SurgeProfileCompilation = {
  readonly ok: boolean;
  readonly artifactKind: "surge-profile";
  readonly diagnostics: readonly Diagnostic[];
  readonly bindings: readonly { readonly id: string; readonly nativeName: string }[];
};
export type SurgeProfileArtifact = {
  readonly artifactKind: "surge-profile";
  readonly content: string;
};
const plans = new WeakMap<SurgeProfileCompilation, SurgeProfileInput>();

export function compileSurgeProfile(input: unknown): SurgeProfileCompilation {
  const diagnostics: Diagnostic[] = [];
  const error = (code: string) =>
    diagnostics.push({ severity: "error", code, path: "$", message: code });
  const failure = (): SurgeProfileCompilation =>
    deepFreeze({ ok: false, artifactKind: "surge-profile", diagnostics, bindings: [] });
  try {
    assertData(input);
  } catch {
    error("INVALID_INPUT_GRAPH");
    return failure();
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    error("INVALID_SCHEMA");
    return failure();
  }
  // Zod object parsing follows schema order; native profile ordering follows the author.
  if (parsed.data.general) {
    const general = parsed.data.general;
    parsed.data.general = Object.fromEntries(
      Object.keys((input as SurgeProfileInput).general!).map((key) => [
        key,
        general[key as keyof SurgeGeneral],
      ]),
    ) as SurgeGeneral;
  }
  const p: SurgeProfileInput = deepFreeze(parsed.data);
  const tunnels = p.tunnels ?? [];
  const resources = [...p.nodes, ...tunnels, ...p.groups];
  if (resources.length > 1000) error("RESOURCE_LIMIT");
  const ids = new Set(resources.map((r) => r.id));
  if (ids.size !== resources.length) error("DUPLICATE_RESOURCE");
  if (Object.keys(p.names ?? {}).some((id) => !ids.has(id))) error("UNKNOWN_NAME_MAPPING");
  const bindings = resources.map((r) => ({ id: r.id, nativeName: p.names?.[r.id] ?? r.id }));
  if (
    bindings.some(
      (b) =>
        !nativeNameSchema.safeParse(b.nativeName).success ||
        isReservedNativeName(b.nativeName, "surge"),
    )
  )
    error("INVALID_NATIVE_NAME");
  if (new Set(bindings.map((b) => b.nativeName)).size !== bindings.length)
    error("DUPLICATE_NATIVE_NAME");
  if (new Set(tunnels.map((t) => t.sectionName)).size !== tunnels.length)
    error("DUPLICATE_TUNNEL_SECTION");
  if (
    p.target.platform === "ios" &&
    ["bypass-system", "replica", "tls-provider", "bypass-tun", "external-controller-access"].some(
      (k) => Object.hasOwn(p.general ?? {}, k),
    )
  )
    error("PLATFORM_OPTION_UNSUPPORTED");
  if (new Set((p.hosts ?? []).map((h) => h.pattern.toLowerCase())).size !== (p.hosts ?? []).length)
    error("DUPLICATE_HOST_PATTERN");
  const checkPolicy = (action: SurgePolicy) => {
    if ("ref" in action && !ids.has(action.ref)) error("MISSING_REFERENCE");
  };
  const edges = new Map(resources.map((r) => [r.id, [] as string[]]));
  const proxyIds = new Set([...p.nodes, ...tunnels].map((n) => n.id));
  for (const node of p.nodes) {
    if (node.type === "vless") error("PROTOCOL_UNSUPPORTED");
    // Option validation is shared across Surge platforms; the profile target is checked above.
    validateProxyOptions(node, { id: "profile", engine: "surge" }, diagnostics);
    if (node.via) {
      checkPolicy({ ref: node.via });
      edges.get(node.id)!.push(node.via);
    }
  }
  for (const group of p.groups) {
    if (
      group.type === "smart" &&
      (group.url !== undefined ||
        group.intervalSeconds !== undefined ||
        group.timeoutSeconds !== undefined)
    )
      error("GROUP_OPTION_UNSUPPORTED");
    for (const member of group.members) {
      checkPolicy(member);
      if (group.type === "smart" && (!("ref" in member) || !proxyIds.has(member.ref)))
        error("SMART_MEMBER_UNSUPPORTED");
      if ("ref" in member) edges.get(group.id)!.push(member.ref);
    }
  }
  const active = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) {
      error("RESOURCE_CYCLE");
      return;
    }
    if (visited.has(id)) return;
    active.add(id);
    for (const next of edges.get(id) ?? []) visit(next);
    active.delete(id);
    visited.add(id);
  };
  if (resources.length <= 1000) for (const id of ids) visit(id);
  const formats = new Map<string, string>();
  const checkCondition = (c: SurgeCondition, depth: number): void => {
    if (depth > 10) {
      error("LOGICAL_DEPTH_EXCEEDED");
      return;
    }
    if (c.noResolve !== undefined && !["ipCidr", "ipCidr6", "ipAsn", "ruleSet"].includes(c.type))
      error("RULE_OPTION_UNSUPPORTED");
    if (c.includeSniffed !== undefined && !["domain", "domainSuffix", "ruleSet"].includes(c.type))
      error("RULE_OPTION_UNSUPPORTED");
    if (p.target.platform === "ios" && ["processName", "macAddress"].includes(c.type))
      error("PLATFORM_RULE_UNSUPPORTED");
    if (c.type === "all" || c.type === "any")
      for (const child of c.conditions) checkCondition(child, depth + 1);
    if (c.type === "not") checkCondition(c.condition, depth + 1);
    if (c.type === "ruleSet") {
      if (c.intervalSeconds !== undefined && (depth > 0 || c.builtin))
        error("RULESET_COMPOSITION_UNSUPPORTED");
      if (c.builtin && c.format !== "rule-set") error("BUILTIN_RULESET_FORMAT");
      if (c.url) {
        const key = new URL(c.url).href;
        const settings = `${c.format}:${c.intervalSeconds ?? 86400}`;
        if (formats.has(key) && formats.get(key) !== settings) error("RULESET_FORMAT_CONFLICT");
        formats.set(key, settings);
      }
    }
  };
  for (const rule of p.rules) {
    checkPolicy(rule.then);
    checkCondition(rule.when, 0);
  }
  checkPolicy(p.fallback);
  if (diagnostics.some((d) => d.severity === "error")) return failure();
  if (formats.size)
    diagnostics.push({
      severity: "warning",
      code: "EXTERNAL_RULESET_UNVERIFIED",
      path: "rules",
      message: "External rule sets are resolved by the client, not by the compiler.",
    });
  const result: SurgeProfileCompilation = deepFreeze({
    ok: true,
    artifactKind: "surge-profile",
    diagnostics,
    bindings,
  });
  plans.set(result, p);
  return result;
}

function conditionOptions(c: SurgeCondition): string[] {
  return [
    ...(c.noResolve ? ["no-resolve"] : []),
    ...("includeSniffed" in c && c.includeSniffed ? ["extended-matching"] : []),
    ...(c.type === "ruleSet" && c.intervalSeconds !== undefined
      ? [`update-interval=${c.intervalSeconds}`]
      : []),
  ];
}
function conditionText(c: SurgeCondition): string {
  switch (c.type) {
    case "all":
    case "any":
      return `${c.type === "all" ? "AND" : "OR"},(${c.conditions.map((x) => `(${[conditionText(x), ...conditionOptions(x)].join(",")})`).join(",")})`;
    case "not":
      return `NOT,((${[conditionText(c.condition), ...conditionOptions(c.condition)].join(",")}))`;
    case "port":
    case "sourcePort":
      return `${c.type === "port" ? "DEST-PORT" : "SRC-PORT"},${c.from}${c.to === undefined || c.to === c.from ? "" : `-${c.to}`}`;
    case "network":
      return `PROTOCOL,${c.value.toUpperCase()}`;
    case "ruleSet":
      return `${c.format === "rule-set" ? "RULE-SET" : "DOMAIN-SET"},${c.url ?? c.builtin}`;
    default: {
      const types = {
        domain: "DOMAIN",
        domainSuffix: "DOMAIN-SUFFIX",
        ipCidr: "IP-CIDR",
        ipCidr6: "IP-CIDR6",
        ipAsn: "IP-ASN",
        sourceIp: "SRC-IP",
        processName: "PROCESS-NAME",
        macAddress: "MAC-ADDRESS",
      };
      return `${types[c.type]},${c.value}`;
    }
  }
}
function renderProfile(
  compilation: SurgeProfileCompilation,
  read: (token: Secret) => string,
): SurgeProfileArtifact {
  const p = plans.get(compilation);
  if (!p) throw new RenderError("COMPILATION_FAILED");
  const name = (id: string) => p.names?.[id] ?? id;
  const action = (value: SurgePolicy) => ("ref" in value ? name(value.ref) : value.builtin);
  const credential = (token: Secret, kind: "key" | "control" | "tailscale"): string => {
    const value = read(token);
    const valid =
      kind === "key"
        ? key.safeParse(value).success
        : kind === "control"
          ? /^[A-Za-z0-9_.+%-]+$/.test(value)
          : /^[A-Za-z0-9_-]+$/.test(value);
    if (!valid) throw new RenderError("SURGE_VALUE_UNREPRESENTABLE");
    return value;
  };
  const lines: string[] = [];
  if (p.managed) {
    const address = new URL(p.managed.url);
    for (const [k, v] of Object.entries(p.managed.query ?? {}))
      address.searchParams.set(k, typeof v === "string" ? v : read(v));
    lines.push(
      `#!MANAGED-CONFIG ${address.href} interval=${p.managed.intervalSeconds} strict=${p.managed.strict}`,
      "",
    );
  }
  lines.push("[General]");
  for (const [k, v] of Object.entries(p.general ?? {})) {
    const value = Array.isArray(v)
      ? v.join(", ")
      : typeof v === "object"
        ? `${credential((v as { password: Secret }).password, "control")}@${(v as { listen: string }).listen}`
        : String(v);
    lines.push(`${k} = ${value}`);
  }
  lines.push("", "[Host]");
  for (const h of p.hosts ?? [])
    lines.push(
      `${h.pattern} = ${[...(h.address ? [h.address] : []), ...(h.server ? [`server:${h.server}`] : [])].join(", ")}`,
    );
  lines.push("", "[Proxy]");
  for (const n of p.nodes) lines.push(surgeProxy(n, read, name));
  for (const t of p.tunnels ?? [])
    lines.push(`${name(t.id)} = ${t.type}, section-name=${t.sectionName}`);
  for (const t of p.tunnels ?? []) {
    lines.push("", `[${t.type === "tailscale" ? "Tailscale" : "WireGuard"} ${t.sectionName}]`);
    if (t.type === "tailscale") {
      lines.push(`auth-key = ${credential(t.authKey, "tailscale")}`, `hostname = ${t.hostname}`);
      if (t.dnsServer) lines.push(`dns-server = ${t.dnsServer.join(", ")}`);
      if (t.autoAddMagicDnsRule !== undefined)
        lines.push(`auto-add-magic-dns-rule = ${t.autoAddMagicDnsRule}`);
      if (t.idleKeepalive !== undefined) lines.push(`idle-keepalive = ${t.idleKeepalive}`);
    } else {
      lines.push(`private-key = ${credential(t.privateKey, "key")}`, `self-ip = ${t.selfIp}`);
      if (t.dnsServer) lines.push(`dns-server = ${t.dnsServer.join(", ")}`);
      if (t.mtu !== undefined) lines.push(`mtu = ${t.mtu}`);
      for (const peer of t.peers) {
        const values = [`public-key = ${peer.publicKey}`];
        if (peer.presharedKey)
          values.push(`preshared-key = ${credential(peer.presharedKey, "key")}`);
        values.push(`allowed-ips = "${peer.allowedIps.join(", ")}"`, `endpoint = ${peer.endpoint}`);
        if (peer.persistentKeepalive !== undefined)
          values.push(`keepalive = ${peer.persistentKeepalive}`);
        lines.push(`peer = (${values.join(", ")})`);
      }
    }
  }
  lines.push("", "[Proxy Group]");
  for (const g of p.groups)
    lines.push(
      `${name(g.id)} = ${[g.type, ...g.members.map(action), ...(g.url ? [`url=${g.url}`] : []), ...(g.intervalSeconds !== undefined ? [`interval=${g.intervalSeconds}`] : []), ...(g.timeoutSeconds !== undefined ? [`timeout=${g.timeoutSeconds}`] : [])].join(", ")}`,
    );
  lines.push("", "[Rule]");
  for (const r of p.rules)
    lines.push([conditionText(r.when), action(r.then), ...conditionOptions(r.when)].join(","));
  lines.push(`FINAL,${action(p.fallback)}`, "");
  return deepFreeze({ artifactKind: "surge-profile", content: lines.join("\n") });
}
export function renderSurgeProfile(
  compilation: SurgeProfileCompilation,
  resolveSecret: (token: Secret) => string,
): SurgeProfileArtifact {
  return renderProfile(compilation, resolveSecret);
}
export function renderSurgeProfiles(
  compilations: readonly SurgeProfileCompilation[],
  resolveSecret: (token: Secret) => string,
): readonly SurgeProfileArtifact[] {
  if (compilations.some((c) => !plans.has(c))) throw new RenderError("COMPILATION_FAILED");
  const read = resolveSecret;
  return deepFreeze(compilations.map((c) => renderProfile(c, read)));
}
