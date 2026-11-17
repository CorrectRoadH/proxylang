// @concord-file
// @concord-implements docs/feature/profile/README.md
import { kindOf } from "./identity.js";
import type { SecretRef } from "./profile-types.js";
import { z } from "zod";
import { validTunAddresses } from "./tun.js";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import type { Match } from "./types.js";

export const idSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/)
  .refine((x) => !x.startsWith("pl-"));
const domain = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const ip = z.string().refine((x) => isIP(x) !== 0 && !x.includes("%"));
const cidr = z.string().refine((x) => {
  try {
    const [address, prefix] = x.split("/");
    if (
      !address ||
      !prefix ||
      !/^\d+$/.test(prefix) ||
      isIP(address) === 0 ||
      address.includes("%")
    )
      return false;
    ipaddr.parseCIDR(x);
    return true;
  } catch {
    return false;
  }
});
export const processNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^/\\*?[\],()\p{C}]+$/u);
const port = z.number().int().min(1).max(65535);
const network = z.enum(["tcp", "udp"]);
const atom = (
  type: "domain" | "domainSuffix" | "ipCidr" | "sourceIp" | "processName",
  value: z.ZodType<string>,
) => z.strictObject({ type: z.literal(type), value });
const remoteBase = {
  type: z.literal("nativeRuleSet"),
  id: idSchema,
  url: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          /^https?:\/\//.test(value) &&
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.hash &&
          !/[\s\p{C},()\\"']/u.test(value)
        );
      } catch {
        return false;
      }
    }),
};
const updateInterval = z.number().int().min(60).max(2147483647);
export const nativeRuleSetSchema = z.discriminatedUnion("engine", [
  z.strictObject({
    ...remoteBase,
    engine: z.literal("surge"),
    format: z.enum(["rule-set", "domain-set"]),
    intervalSeconds: updateInterval.optional(),
    noResolve: z.boolean().optional(),
    includeSniffed: z.boolean().optional(),
  }),
  z.strictObject({
    ...remoteBase,
    engine: z.literal("sing-box"),
    format: z.enum(["source", "binary"]),
    intervalSeconds: updateInterval,
    resolve: z.boolean().optional(),
  }),
  z.strictObject({
    ...remoteBase,
    engine: z.literal("mihomo"),
    format: z.enum(["yaml", "text"]),
    behavior: z.enum(["domain", "ipcidr", "classical"]),
    intervalSeconds: updateInterval,
  }),
]);
export const matchSchema: z.ZodType<Match> = z.lazy(() =>
  z.discriminatedUnion("type", [
    nativeRuleSetSchema,
    z.strictObject({
      type: z.literal("domain"),
      value: domain,
      includeSniffed: z.boolean().optional(),
    }),
    z.strictObject({
      type: z.literal("domainSuffix"),
      value: domain,
      includeSniffed: z.boolean().optional(),
    }),
    z.strictObject({ type: z.literal("ipCidr"), value: cidr, noResolve: z.boolean().optional() }),
    atom("sourceIp", z.union([ip, cidr])),
    atom("processName", processNameSchema),
    z.strictObject({ type: z.literal("port"), from: port, to: port }).refine((v) => v.from <= v.to),
    z
      .strictObject({ type: z.literal("sourcePort"), from: port, to: port })
      .refine((v) => v.from <= v.to),
    z.strictObject({ type: z.literal("network"), value: network }),
    z.strictObject({ type: z.enum(["all", "any"]), conditions: z.array(matchSchema).min(1) }),
    z.strictObject({ type: z.literal("not"), condition: matchSchema }),
  ]),
);
const unique = (values: readonly string[]) => new Set(values).size === values.length;
export const secretSchema = z.custom<SecretRef>((v) => kindOf(v) === "secret");
const nodeBase = {
  id: idSchema,
  server: z.union([ip, domain]),
  port,
  via: idSchema.optional(),
  tcpFastOpen: z.boolean().optional(),
};
const tlsSchema = z.strictObject({
  serverName: domain,
  skipCertVerify: z.boolean().optional(),
  alpn: z
    .array(
      z
        .string()
        .min(1)
        .refine((x) => !/\p{C}/u.test(x) && Buffer.byteLength(x) <= 255),
    )
    .min(1)
    .refine(unique)
    .optional(),
});
const transportSchema = z.strictObject({
  type: z.literal("ws"),
  path: z
    .string()
    .max(2048)
    .regex(/^\/[A-Za-z0-9/._~-]*$/)
    .refine((x) => !x.startsWith("//")),
  host: domain.optional(),
});
const uuidNode = {
  ...nodeBase,
  uuid: secretSchema,
  tls: tlsSchema.optional(),
  transport: transportSchema.optional(),
};
const surgeOptions = {
  blockQuic: z.enum(["auto", "on", "off"]).optional(),
};
const portHoppingSchema = z
  .string()
  .max(2048)
  .regex(/^[0-9]+(?:-[0-9]+)?(?:;[0-9]+(?:-[0-9]+)?)*$/)
  .refine((value) =>
    value.split(";").every((part) => {
      const [start, end = start] = part.split("-").map(Number);
      return start !== undefined && end !== undefined && start >= 1 && end <= 65535 && start <= end;
    }),
  );
export const nodeSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      ...nodeBase,
      type: z.literal("trojan"),
      password: secretSchema,
      serverName: domain.optional(),
      skipCertVerify: z.boolean().optional(),
      surge: z.strictObject({ ...surgeOptions, udpRelay: z.literal(true).optional() }).optional(),
    }),
    z.strictObject({
      ...nodeBase,
      type: z.literal("anytls"),
      password: secretSchema,
      serverName: domain.optional(),
      skipCertVerify: z.boolean().optional(),
      surge: z.strictObject({ ...surgeOptions, udpRelay: z.literal(true).optional() }).optional(),
    }),
    z
      .strictObject({
        ...nodeBase,
        type: z.literal("hysteria2"),
        tcpFastOpen: z.never().optional(),
        password: secretSchema,
        serverName: domain.optional(),
        skipCertVerify: z.boolean().optional(),
        portHopping: portHoppingSchema.optional(),
        portHoppingInterval: z.number().int().positive().optional(),
      })
      .refine((node) => node.portHoppingInterval === undefined || node.portHopping !== undefined),
    z.strictObject({
      ...nodeBase,
      type: z.literal("http"),
      serverName: z.undefined().optional(),
      password: secretSchema,
      username: secretSchema.optional(),
    }),
    z.strictObject({
      ...nodeBase,
      type: z.literal("shadowsocks"),
      surge: z.strictObject({ ...surgeOptions, udpRelay: z.boolean().optional() }).optional(),
      method: z.enum(["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"]),
      password: secretSchema,
    }),
    z.strictObject({
      ...uuidNode,
      type: z.literal("vmess"),
      surge: z.strictObject(surgeOptions).optional(),
    }),
    z
      .strictObject({
        ...uuidNode,
        type: z.literal("vless"),
        flow: z.literal("xtls-rprx-vision").optional(),
        packetEncoding: z.enum(["xudp", "packetaddr"]).optional(),
        utlsFingerprint: z.literal("chrome").optional(),
        reality: z
          .strictObject({
            publicKey: z
              .string()
              .regex(/^[A-Za-z0-9_-]{43}$/)
              .refine((value) => Buffer.from(value, "base64url").toString("base64url") === value),
            shortId: z.string().regex(/^(?:[0-9a-fA-F]{2}){0,8}$/),
          })
          .optional(),
      })
      .refine((node) => !node.reality || (!!node.tls && node.utlsFingerprint === "chrome"))
      .refine((node) => !node.flow || (!!node.tls && !node.transport))
      .refine((node) => !node.utlsFingerprint || !!node.tls),
  ])
  .refine(
    (node) =>
      !("transport" in node && node.transport && node.tls?.alpn) ||
      (node.tls.alpn.length === 1 && node.tls.alpn[0] === "http/1.1"),
  );
export const endpointSchema = z
  .strictObject({
    type: z.literal("sing-box-tailscale"),
    id: idSchema,
    hostname: domain.refine((x) => !x.includes(".")),
    stateDirectory: z
      .string()
      .max(4096)
      .refine(
        (x) =>
          x.startsWith("/") &&
          !/[\p{C}$\\]/u.test(x) &&
          x
            .split("/")
            .slice(1)
            .every((part) => part !== "" && part !== "." && part !== ".."),
      ),
    acceptRoutes: z.boolean(),
    bootstrapResolver: ip,
    authKey: secretSchema.optional(),
    exitNode: ip.optional(),
    exitNodeAllowLanAccess: z.boolean().optional(),
  })
  .refine(
    (endpoint) => endpoint.exitNodeAllowLanAccess === undefined || endpoint.exitNode !== undefined,
  );
export function assertData(value: unknown): void {
  const ancestors = new Set<object>();
  let count = 0;
  const visit = (v: unknown, depth: number): void => {
    if (++count > 100_000 || depth > 64) throw new Error("INPUT_LIMIT");
    if (v === undefined || v === null || ["string", "number", "boolean"].includes(typeof v)) return;
    if (typeof v !== "object" || ancestors.has(v)) throw new Error("INPUT_GRAPH");
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new Error("INPUT_OBJECT");
    ancestors.add(v);
    for (const key of Reflect.ownKeys(v)) {
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (
        typeof key !== "string" ||
        !("value" in descriptor) ||
        (!descriptor.enumerable && !(Array.isArray(v) && key === "length"))
      )
        throw new Error("INPUT_OBJECT");
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(v);
  };
  visit(value, 0);
}
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

export const engineOptionsSchema = z.strictObject({
  mode: z.enum(["standalone", "fragment"]).optional(),
  listener: z.strictObject({ port, resolver: ip }).optional(),
  domainMatching: z.literal("prefer-sniffed").optional(),
  serverAliases: z.record(domain, z.union([domain, ip])).optional(),
  cacheFile: z.boolean().optional(),
  unsupportedUdp: z.literal("reject").optional(),
  tun: z
    .strictObject({
      address: z.array(cidr).min(1).max(2).refine(validTunAddresses),
      stack: z.enum(["system", "gvisor", "mixed"]),
      autoRoute: z.boolean(),
      strictRoute: z.boolean(),
      dnsMode: z.enum(["disabled", "native", "hijack"]),
      routeExcludeAddress: z.array(cidr).optional(),
    })
    .refine((t) => !t.strictRoute || t.autoRoute)
    .optional(),
});
