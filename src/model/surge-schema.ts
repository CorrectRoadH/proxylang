// @concord-file
// @concord-implements docs/feature/profile/library/surge.md
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { z } from "zod";
import { idSchema, nodeSchema, secretSchema } from "./schema.js";
import { nativeNameSchema } from "./names.js";
import type { ProxyNode } from "./types.js";

const builtin = z.enum(["DIRECT", "REJECT", "REJECT-DROP", "REJECT-NO-DROP", "REJECT-TINYGIF"]);
const policy = z.union([z.strictObject({ ref: idSchema }), z.strictObject({ builtin })]);
export type SurgePolicy = z.infer<typeof policy>;
const token = secretSchema;
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
/** Internal fragment validation; caller must inspect data descriptors before invoking. */
export const validateSurgeGeneral = (input: unknown): boolean =>
  generalSchema.safeParse(input).success;
export const hostSchema = z
  .strictObject({
    pattern: hostPattern,
    address: z.union([ip, domain]).optional(),
    server: z.union([dns, encryptedDns]).optional(),
  })
  .refine((v) => v.address !== undefined || v.server !== undefined);
export type SurgeHost = z.infer<typeof hostSchema>;
export const key = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/)
  .refine(
    (v) =>
      Buffer.from(v, "base64").length === 32 && Buffer.from(v, "base64").toString("base64") === v,
  );
const sectionName = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/);
export const tunnelSchema = z.discriminatedUnion("type", [
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
export const groupTestSchema = groupSchema
  .pick({ url: true, intervalSeconds: true, timeoutSeconds: true })
  .required({ url: true });
export type SurgeGroup = z.infer<typeof groupSchema>;
type NoSniff = { readonly includeSniffed?: never };
export type SurgeCondition = { readonly noResolve?: boolean } & (
  | {
      readonly type: "domain" | "domainSuffix";
      readonly value: string;
      readonly includeSniffed?: boolean;
    }
  | (NoSniff & {
      readonly type: "ipCidr" | "ipCidr6" | "sourceIp" | "processName" | "macAddress";
      readonly value: string;
    })
  | (NoSniff & {
      readonly type: "port" | "sourcePort";
      readonly from: number;
      readonly to?: number;
    })
  | (NoSniff & { readonly type: "network"; readonly value: "tcp" | "udp" })
  | (NoSniff & { readonly type: "ipAsn"; readonly value: number })
  | (NoSniff & { readonly type: "all" | "any"; readonly conditions: readonly SurgeCondition[] })
  | (NoSniff & { readonly type: "not"; readonly condition: SurgeCondition })
  | {
      readonly type: "ruleSet";
      readonly format: "rule-set" | "domain-set";
      readonly url?: string;
      readonly builtin?: "LAN" | "SYSTEM";
      readonly intervalSeconds?: number;
      readonly includeSniffed?: boolean;
    }
);
const options = { noResolve: z.boolean().optional() };
const domainOptions = { ...options, includeSniffed: z.boolean().optional() };
const atom = (type: string, value: z.ZodType<string>) =>
  z.strictObject({
    type: z.literal(type),
    value,
    ...(["domain", "domainSuffix"].includes(type) ? domainOptions : options),
  });
export const conditionSchema: z.ZodType<SurgeCondition> = z.lazy(
  () =>
    z.union([
      atom("domain", domain),
      atom("domainSuffix", domain),
      atom("ipCidr", cidr(4)),
      atom("ipCidr6", cidr(6)),
      z.strictObject({
        type: z.literal("ipAsn"),
        value: z.number().int().min(1).max(4294967295),
        ...options,
      }),
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
          intervalSeconds: z.number().int().min(60).max(2147483647).optional(),
          ...domainOptions,
        })
        .refine((v) => (v.url !== undefined) !== (v.builtin !== undefined)),
    ]) as z.ZodType<SurgeCondition>,
);
export type SurgeRule = { readonly when: SurgeCondition; readonly then: SurgePolicy };
export const managedSchema = z.strictObject({
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
export const inputSchema = z.strictObject({
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
