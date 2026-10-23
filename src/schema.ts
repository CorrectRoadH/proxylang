// @concord-file
// @concord-implements docs/feature/rule-composition/README.md
import { z } from "zod";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import type {
  Config,
  Entry,
  Match,
  Policy,
  Request,
  GroupAlgorithm,
  Strategy,
  PortableAlgorithm,
} from "./types.js";

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
const port = z.number().int().min(1).max(65535);
const network = z.enum(["tcp", "udp"]);
const atom = (type: "domain" | "domainSuffix" | "ipCidr" | "sourceIp", value: z.ZodType<string>) =>
  z.strictObject({ type: z.literal(type), value });
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
const nativeRuleSetSchema = z.discriminatedUnion("engine", [
  z.strictObject({
    ...remoteBase,
    engine: z.literal("surge"),
    format: z.enum(["rule-set", "domain-set"]),
    intervalSeconds: updateInterval.optional(),
  }),
  z.strictObject({
    ...remoteBase,
    engine: z.literal("sing-box"),
    format: z.enum(["source", "binary"]),
    intervalSeconds: updateInterval,
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
    z.strictObject({ type: z.literal("ruleSet"), id: idSchema, when: matchSchema }),
    atom("domain", domain),
    atom("domainSuffix", domain),
    atom("ipCidr", cidr),
    atom("sourceIp", cidr),
    z.strictObject({ type: z.literal("port"), from: port, to: port }).refine((v) => v.from <= v.to),
    z
      .strictObject({ type: z.literal("sourcePort"), from: port, to: port })
      .refine((v) => v.from <= v.to),
    z.strictObject({ type: z.literal("network"), value: network }),
    z.strictObject({ type: z.enum(["all", "any"]), conditions: z.array(matchSchema).min(1) }),
    z.strictObject({ type: z.literal("not"), condition: matchSchema }),
  ]),
);
export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.enum(["direct", "reject"]) }),
  z.strictObject({ type: z.literal("route"), to: idSchema }),
]);
const slotSchema = z.strictObject({ type: z.literal("slot"), name: idSchema });
const ruleAction = z.discriminatedUnion("type", [actionSchema, slotSchema]);
const unique = (items: readonly string[]) => new Set(items).size === items.length;
const policySchema: z.ZodType<Policy> = z.lazy(() =>
  z.strictObject({
    type: z.literal("policy"),
    id: idSchema,
    exits: z.array(idSchema).refine(unique),
    rules: z.array(entrySchema).min(1),
  }),
);
export const entrySchema: z.ZodType<Entry> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("rule"), id: idSchema, when: matchSchema, then: ruleAction }),
    z.strictObject({
      type: z.literal("block"),
      id: idSchema,
      rules: z.array(entrySchema).min(1),
      when: matchSchema.optional(),
    }),
    z.strictObject({
      type: z.literal("use"),
      id: idSchema,
      policy: policySchema,
      bindings: z.record(idSchema, ruleAction),
    }),
  ]),
);
const secretSchema = z.strictObject({
  type: z.literal("env"),
  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
});
const nodeBase = {
  id: idSchema,
  server: z.union([ip, domain]),
  port,
  via: idSchema.optional(),
  tcpFastOpen: z.boolean().optional(),
  label: z.string().min(1).max(256).optional(),
  region: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  provider: idSchema.optional(),
  tags: z.array(idSchema).refine(unique).optional(),
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
    z.strictObject({ ...uuidNode, type: z.literal("vless") }),
  ])
  .refine(
    (node) =>
      !("transport" in node && node.transport && node.tls?.alpn) ||
      (node.tls.alpn.length === 1 && node.tls.alpn[0] === "http/1.1"),
  );
const endpointSchema = z
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
const members = z.array(idSchema).min(1).refine(unique);
const url = z
  .string()
  .url()
  .refine((value) => {
    try {
      const u = new URL(value);
      return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && !u.hash;
    } catch {
      return false;
    }
  });
const urltestAlgorithmSchema = z.strictObject({
  type: z.literal("urltest"),
  url,
  intervalSeconds: z.number().int().min(1).max(86400).default(180),
  toleranceMs: z.number().int().min(0).max(60000).default(50),
});
export const algorithmSchema: z.ZodType<GroupAlgorithm> = z.union([
  z.strictObject({ type: z.enum(["select", "surge-smart"]) }),
  urltestAlgorithmSchema,
]);
const portableAlgorithmSchema: z.ZodType<PortableAlgorithm> = z.union([
  z.strictObject({ type: z.enum(["select", "auto"]) }),
  urltestAlgorithmSchema,
]);
const implementationsSchema = z.strictObject({
  surge: algorithmSchema.optional(),
  "sing-box": algorithmSchema.optional(),
  mihomo: algorithmSchema.optional(),
  stash: algorithmSchema.optional(),
});
const strategyBase = {
  type: z.literal("strategy"),
  id: idSchema,
  members,
};
export const strategySchema: z.ZodType<Strategy> = z.union([
  z.strictObject({
    ...strategyBase,
    algorithm: portableAlgorithmSchema,
    implementations: implementationsSchema.optional(),
  }),
  z.strictObject({
    ...strategyBase,
    implementations: implementationsSchema.refine(
      (v) => !!v.surge || !!v["sing-box"] || !!v.mihomo || !!v.stash,
    ),
  }),
]);
const groupSchema = z.union([
  strategySchema,
  z.strictObject({ type: z.enum(["select", "smart"]), id: idSchema, members }),
  z.strictObject({
    type: z.literal("urltest"),
    id: idSchema,
    members,
    url,
    intervalSeconds: z.number().int().min(1).max(86400).default(180),
    toleranceMs: z.number().int().min(0).max(60000).default(50),
  }),
]);
export const requestSchema: z.ZodType<Request> = z.strictObject({
  network,
  domain: domain.optional(),
  ip: ip.optional(),
  sourceIp: ip.optional(),
  port: port.optional(),
  sourcePort: port.optional(),
});
export const configSchema: z.ZodType<Config> = z.strictObject({
  programs: z.record(
    idSchema,
    z.strictObject({
      engine: z.enum(["surge", "sing-box", "mihomo", "stash"]),
      nodes: z.array(nodeSchema),
      endpoints: z.array(endpointSchema).max(1000).optional(),
      groups: z.array(groupSchema),
      routing: z.array(entrySchema),
      fallback: actionSchema,
      listener: z.strictObject({ port, resolver: ip }).optional(),
    }),
  ),
  targets: z
    .array(
      z.strictObject({
        id: idSchema,
        program: idSchema,
        engine: z.enum(["surge", "sing-box", "mihomo", "stash"]),
        platform: z.enum(["macos", "linux"]),
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        mode: z.enum(["fragment", "standalone"]).default("fragment"),
      }),
    )
    .min(1),
  cases: z
    .array(
      z.strictObject({
        id: idSchema,
        program: idSchema,
        request: requestSchema,
        expect: z.strictObject({ rule: z.string().min(1).optional(), action: actionSchema }),
      }),
    )
    .optional(),
  warningsAsErrors: z.boolean().optional(),
});

/** Only schema-owned constraints are rendered; Zod messages can contain input values. */
export function schemaIssueMessage(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return `字段类型错误或缺失；需要 ${issue.expected}`;
    case "too_small":
      return `字段低于下限；${issue.origin} 的最小值或长度为 ${issue.minimum}`;
    case "too_big":
      return `字段超过上限；${issue.origin} 的最大值或长度为 ${issue.maximum}`;
    case "invalid_value":
      return `字段必须使用声明的枚举值：${issue.values.map(String).join("、")}`;
    case "invalid_format":
      return "字段格式不符合约束；检查域名、标识符或路径格式";
    case "unrecognized_keys":
      return "对象包含当前声明不支持的字段；请删除额外字段";
    case "invalid_union":
      return "声明不符合任何支持的分支；检查 type、engine 及对应必填字段";
    default:
      return "字段不满足语义约束；检查地址、范围顺序、重复项或相关字段组合";
  }
}

/** Reject cycles, executable values and excessive expansion before recursive schema parsing. */
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
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(v))) {
      if (descriptor.get || descriptor.set) throw new Error("INPUT_ACCESSOR");
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
