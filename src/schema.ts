// @concord-file
// @concord-implements docs/feature/rule-composition/README.md
import { z } from "zod";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import type { Config, Entry, Match, Policy, Request, GroupAlgorithm, Strategy } from "./types.js";

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
export const matchSchema: z.ZodType<Match> = z.lazy(() =>
  z.union([
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
export const actionSchema = z.union([
  z.strictObject({ type: z.enum(["direct", "reject"]) }),
  z.strictObject({ type: z.literal("route"), to: idSchema }),
]);
const slotSchema = z.strictObject({ type: z.literal("slot"), name: idSchema });
const ruleAction = z.union([actionSchema, slotSchema]);
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
  z.union([
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
const nodeSchema = z
  .strictObject({
    id: idSchema,
    type: z.enum(["trojan", "anytls", "http"]),
    server: ip,
    port,
    password: secretSchema,
    username: secretSchema.optional(),
    serverName: domain.optional(),
    via: idSchema.optional(),
    label: z.string().min(1).max(256).optional(),
    region: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    provider: idSchema.optional(),
    tags: z.array(idSchema).refine(unique).optional(),
  })
  .refine((n) => (n.type === "http" ? n.serverName === undefined : n.username === undefined));
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
export const algorithmSchema: z.ZodType<GroupAlgorithm> = z.union([
  z.strictObject({ type: z.enum(["select", "surge-smart"]) }),
  z.strictObject({
    type: z.literal("urltest"),
    url,
    intervalSeconds: z.number().int().min(1).max(86400).default(180),
    toleranceMs: z.number().int().min(0).max(60000).default(50),
  }),
]);
export const strategySchema: z.ZodType<Strategy> = z.strictObject({
  type: z.literal("strategy"),
  id: idSchema,
  members,
  implementations: z
    .strictObject({ surge: algorithmSchema.optional(), "sing-box": algorithmSchema.optional() })
    .refine((v) => !!v.surge || !!v["sing-box"]),
});
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
      engine: z.enum(["surge", "sing-box"]),
      nodes: z.array(nodeSchema),
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
        engine: z.enum(["surge", "sing-box"]),
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
