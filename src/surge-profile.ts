// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/surge-profile.md
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { z } from "zod";
import { assertData, deepFreeze, idSchema, nodeSchema } from "./schema.js";
import { nativeNameSchema, isReservedNativeName } from "./native-names.js";
import { RenderError, surgeProxy, validateProxyOptions } from "./proxies.js";
import { secretReader } from "./secrets.js";
import type { Diagnostic, ProxyNode, Secret } from "./types.js";

const builtin = z.enum(["DIRECT", "REJECT", "REJECT-DROP", "REJECT-NO-DROP", "REJECT-TINYGIF"]);
const policy = z.union([z.strictObject({ ref: idSchema }), z.strictObject({ builtin })]);
export type SurgePolicy = z.infer<typeof policy>;
const token = z.strictObject({
  type: z.literal("env"),
  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
});
const safe = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => v.trim() === v && !/[\p{C}\p{Zl}\p{Zp},=()#;"'\\]/u.test(v));
const domain = z
  .string()
  .max(253)
  .regex(
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
  );
const hostPattern = safe.refine((v) => /^[a-zA-Z0-9*?._-]+$/.test(v));
const ip = safe.refine((v) => isIP(v) !== 0 && !v.includes("%"));
const cidr = (version?: 4 | 6) =>
  safe.refine((v) => {
    try {
      const [address] = ipaddr.parseCIDR(v);
      return (!version || (address.kind() === "ipv4" ? 4 : 6) === version) && !v.includes("%");
    } catch {
      return false;
    }
  });
const port = z.number().int().min(1).max(65535);
function addressPort(value: string, allowHost: boolean, portRequired: boolean): boolean {
  if (!portRequired && isIP(value)) return true;
  const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return false;
  const host = match[1]!;
  return host.startsWith("[")
    ? isIP(host.slice(1, -1)) === 6
    : isIP(host) === 4 || (allowHost && domain.safeParse(host).success);
}
const listener = safe.refine((v) => addressPort(v, false, false));
const endpoint = safe.refine((v) => addressPort(v, true, true));
const dns = safe.refine((v) => v === "system" || addressPort(v, false, false));
const url = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        /^https?:\/\//.test(v) &&
        !u.username &&
        !u.password &&
        !u.hash &&
        !/[\s\p{C},()\\"']/u.test(v)
      );
    } catch {
      return false;
    }
  });
const encryptedDns = z
  .string()
  .max(4096)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        ["https:", "h3:", "quic:", "tls:", "tcp:"].includes(u.protocol) &&
        !!u.hostname &&
        !u.username &&
        !u.password &&
        !u.hash &&
        !/[\s\p{C},()\\"']/u.test(v)
      );
    } catch {
      return false;
    }
  });
const list = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(1000);
const control = z.strictObject({
  password: token,
  listen: safe.refine((v) => addressPort(v, false, true)),
});
const generalSchema = z.strictObject({
  loglevel: z.enum(["verbose", "info", "notify", "warning"]).optional(),
  "dns-server": list(dns).optional(),
  "encrypted-dns-server": list(encryptedDns).optional(),
  "show-error-page-for-reject": z.boolean().optional(),
  "exclude-simple-hostnames": z.boolean().optional(),
  "internet-test-url": url.optional(),
  "skip-proxy": list(z.union([hostPattern, ip, cidr()])).optional(),
  ipv6: z.boolean().optional(),
  "ipv6-vif": z.enum(["auto", "always", "disabled"]).optional(),
  "bypass-system": z.boolean().optional(),
  replica: z.boolean().optional(),
  "tls-provider": z.enum(["default", "openssl"]).optional(),
  "bypass-tun": list(cidr()).optional(),
  "always-real-ip": list(hostPattern).optional(),
  "http-api": control.optional(),
  "http-api-web-dashboard": z.boolean().optional(),
  "external-controller-access": control.optional(),
  "hijack-dns": list(
    safe.refine((v) =>
      /^\*(?::\d+)?$/.test(v)
        ? !v.includes(":") || (Number(v.slice(2)) > 0 && Number(v.slice(2)) <= 65535)
        : addressPort(v, false, false),
    ),
  ).optional(),
  "http-listen": listener.optional(),
  "socks5-listen": listener.optional(),
  "proxy-restricted-to-lan": z.boolean().optional(),
});
export type SurgeGeneral = z.infer<typeof generalSchema>;
const hostSchema = z
  .strictObject({
    pattern: hostPattern,
    address: z.union([ip, domain]).optional(),
    server: z.union([dns, encryptedDns]).optional(),
  })
  .refine((v) => v.address !== undefined || v.server !== undefined);
export type SurgeHost = z.infer<typeof hostSchema>;
const key = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/)
  .refine(
    (v) =>
      Buffer.from(v, "base64").length === 32 && Buffer.from(v, "base64").toString("base64") === v,
  );
const sectionName = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/);
const tunnelSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("tailscale"),
    id: idSchema,
    sectionName,
    authKey: token,
    hostname: domain,
    dnsServer: list(dns).optional(),
    autoAddMagicDnsRule: z.boolean().optional(),
    idleKeepalive: z.number().int().min(-1).max(2147483647).optional(),
  }),
  z.strictObject({
    type: z.literal("wireguard"),
    id: idSchema,
    sectionName,
    privateKey: token,
    selfIp: ip.refine((v) => isIP(v) === 4),
    dnsServer: list(dns).optional(),
    mtu: z.number().int().min(576).max(9000).optional(),
    peers: list(
      z.strictObject({
        publicKey: key,
        endpoint,
        allowedIps: list(cidr()),
        presharedKey: token.optional(),
        persistentKeepalive: z.number().int().min(0).max(65535).optional(),
      }),
    ),
  }),
]);
export type SurgeTunnel = z.infer<typeof tunnelSchema>;
const groupSchema = z.strictObject({
  id: idSchema,
  type: z.enum(["select", "smart"]),
  members: list(policy),
  url: url.optional(),
  intervalSeconds: z.number().int().positive().max(2147483647).optional(),
  timeoutSeconds: z.number().int().positive().max(3600).optional(),
});
export type SurgeGroup = z.infer<typeof groupSchema>;
type ConditionOptions = { readonly noResolve?: boolean; readonly extendedMatching?: boolean };
export type SurgeCondition = ConditionOptions &
  (
    | {
        readonly type:
          | "domain"
          | "domainSuffix"
          | "ipCidr"
          | "ipCidr6"
          | "sourceIp"
          | "processName"
          | "macAddress";
        readonly value: string;
      }
    | { readonly type: "port" | "sourcePort"; readonly from: number; readonly to?: number }
    | { readonly type: "network"; readonly value: "tcp" | "udp" }
    | { readonly type: "all" | "any"; readonly conditions: readonly SurgeCondition[] }
    | { readonly type: "not"; readonly condition: SurgeCondition }
    | {
        readonly type: "ruleSet";
        readonly format: "rule-set" | "domain-set";
        readonly url?: string;
        readonly builtin?: "LAN" | "SYSTEM";
      }
  );
const options = { noResolve: z.boolean().optional(), extendedMatching: z.boolean().optional() };
const atom = (type: string, value: z.ZodType<string>) =>
  z.strictObject({ type: z.literal(type), value, ...options });
const conditionSchema: z.ZodType<SurgeCondition> = z.lazy(
  () =>
    z.union([
      atom("domain", domain),
      atom("domainSuffix", domain),
      atom("ipCidr", cidr(4)),
      atom("ipCidr6", cidr(6)),
      atom("sourceIp", z.union([ip, cidr()])),
      atom("processName", safe),
      atom("macAddress", z.string().regex(/^(?:[\da-fA-F]{2}:){5}[\da-fA-F]{2}$/)),
      z
        .strictObject({
          type: z.enum(["port", "sourcePort"]),
          from: port,
          to: port.optional(),
          ...options,
        })
        .refine((v) => v.to === undefined || v.to >= v.from),
      z.strictObject({ type: z.literal("network"), value: z.enum(["tcp", "udp"]), ...options }),
      z.strictObject({
        type: z.enum(["all", "any"]),
        conditions: z.array(conditionSchema).min(2).max(100),
        ...options,
      }),
      z.strictObject({ type: z.literal("not"), condition: conditionSchema, ...options }),
      z
        .strictObject({
          type: z.literal("ruleSet"),
          format: z.enum(["rule-set", "domain-set"]),
          url: url.optional(),
          builtin: z.enum(["LAN", "SYSTEM"]).optional(),
          ...options,
        })
        .refine((v) => (v.url !== undefined) !== (v.builtin !== undefined)),
    ]) as z.ZodType<SurgeCondition>,
);
export type SurgeRule = { readonly when: SurgeCondition; readonly then: SurgePolicy };
const managedSchema = z.strictObject({
  url: url.refine((v) => !new URL(v).search && !v.includes("?")),
  query: z
    .record(
      z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
      z.union([z.string().max(4096), token]),
    )
    .optional(),
  intervalSeconds: z.number().int().min(60).max(2147483647),
  strict: z.boolean(),
});
export type SurgeProfileInput = {
  readonly target: {
    readonly engine: "surge";
    readonly platform: "macos" | "ios";
    readonly version: string;
  };
  readonly managed?: z.infer<typeof managedSchema>;
  readonly general?: SurgeGeneral;
  readonly hosts?: readonly SurgeHost[];
  readonly nodes: readonly ProxyNode[];
  readonly tunnels?: readonly SurgeTunnel[];
  readonly groups: readonly SurgeGroup[];
  readonly rules: readonly SurgeRule[];
  readonly fallback: SurgePolicy;
  readonly names?: Readonly<Record<string, string>>;
};
const inputSchema = z.strictObject({
  target: z.strictObject({
    engine: z.literal("surge"),
    platform: z.enum(["macos", "ios"]),
    version: z.string(),
  }),
  managed: managedSchema.optional(),
  general: generalSchema.optional(),
  hosts: z.array(hostSchema).max(2000).optional(),
  nodes: z.array(nodeSchema).max(1000),
  tunnels: z.array(tunnelSchema).max(1000).optional(),
  groups: z.array(groupSchema).max(1000),
  rules: z.array(z.strictObject({ when: conditionSchema, then: policy })).max(10000),
  fallback: policy,
  names: z.record(idSchema, nativeNameSchema).optional(),
});
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
  const p: SurgeProfileInput = deepFreeze(parsed.data);
  if (
    !(p.target.platform === "macos" && p.target.version === "6.10.0") &&
    !(p.target.platform === "ios" && p.target.version === "5.21.0")
  )
    error("UNKNOWN_TARGET");
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
    if (c.noResolve !== undefined && !["ipCidr", "ipCidr6", "ruleSet"].includes(c.type))
      error("RULE_OPTION_UNSUPPORTED");
    if (c.extendedMatching !== undefined && !["domain", "domainSuffix", "ruleSet"].includes(c.type))
      error("RULE_OPTION_UNSUPPORTED");
    if (p.target.platform === "ios" && ["processName", "macAddress"].includes(c.type))
      error("PLATFORM_RULE_UNSUPPORTED");
    if (c.type === "all" || c.type === "any")
      for (const child of c.conditions) checkCondition(child, depth + 1);
    if (c.type === "not") checkCondition(c.condition, depth + 1);
    if (c.type === "ruleSet") {
      if (c.builtin && c.format !== "rule-set") error("BUILTIN_RULESET_FORMAT");
      if (c.url) {
        if (formats.has(c.url) && formats.get(c.url) !== c.format) error("RULESET_FORMAT_CONFLICT");
        formats.set(c.url, c.format);
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
    ...(c.extendedMatching ? ["extended-matching"] : []),
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
  resolveSecret: (token: Secret) => string | undefined,
): SurgeProfileArtifact {
  return renderProfile(compilation, secretReader(resolveSecret));
}
export function renderSurgeProfiles(
  compilations: readonly SurgeProfileCompilation[],
  resolveSecret: (token: Secret) => string | undefined,
): readonly SurgeProfileArtifact[] {
  if (compilations.some((c) => !plans.has(c))) throw new RenderError("COMPILATION_FAILED");
  const read = secretReader(resolveSecret);
  return deepFreeze(compilations.map((c) => renderProfile(c, read)));
}
