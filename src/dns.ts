// @concord-file
// @concord-implements docs/feature/target-compilation/README.md
import { isIP } from "node:net";
import { z } from "zod";
import type { DnsRule } from "./types.js";

const domain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
export function dohUrl(value: string): URL {
  const url = new URL(value);
  // An absent path uses the protocol default; an explicit slash is preserved.
  if (!/^https:\/\/[^/]+\//.test(value)) url.pathname = "/dns-query";
  return url;
}
const server = z
  .string()
  .max(2048)
  .refine((value) => {
    if (isIP(value) && !value.includes("%")) return true;
    if (!value.startsWith("https://") || /[\s\p{C},()\\"'?#]/u.test(value)) return false;
    try {
      const url = new URL(value);
      const authority = value.slice(8).split("/")[0]!;
      const path = value.slice(8 + authority.length);
      return (
        !url.username &&
        !url.password &&
        !authority.endsWith(":") &&
        !!url.hostname &&
        (!path || url.pathname === path)
      );
    } catch {
      return false;
    }
  });
export const dnsRulesSchema = z
  .array(
    z.strictObject({
      pattern: z
        .string()
        .min(1)
        .max(253)
        .refine((value) => domain.test(value.startsWith("*.") ? value.slice(2) : value)),
      server,
    }),
  )
  .max(2000)
  .superRefine((rules, ctx) => {
    if (
      rules.length > 2000 ||
      rules.some((rule) => rule.pattern.length > 253 || rule.server.length > 2048)
    )
      return;
    for (let i = 0; i < rules.length; i++)
      for (let j = 0; j < i; j++) {
        const a = rules[i]!,
          b = rules[j]!;
        const x = a.pattern.toLowerCase(),
          y = b.pattern.toLowerCase();
        if (x === y || (overlap(x, y) && a.server !== b.server)) {
          ctx.addIssue({ code: "custom", message: "DNS_RULE_CONFLICT" });
          return;
        }
      }
  });
function overlap(a: string, b: string): boolean {
  const wildA = a.startsWith("*."),
    wildB = b.startsWith("*.");
  if (wildA && wildB) return a.slice(1).endsWith(b.slice(1)) || b.slice(1).endsWith(a.slice(1));
  return wildA ? b.endsWith(a.slice(1)) : wildB && a.endsWith(b.slice(1));
}
export function dnsCondition(rule: DnsRule): { domain: string[] } | { domain_regex: string[] } {
  const pattern = rule.pattern.toLowerCase();
  return pattern.startsWith("*.")
    ? { domain_regex: [`^.+\\.${pattern.slice(2).replaceAll(".", "\\.")}$`] }
    : { domain: [pattern] };
}
