// @concord-file
// @concord-implements docs/feature/profile/library/README.md
import {
  exactDefinition,
  inspectDefinition,
  ProfileDefinitionError,
} from "../model/definitions.js";
import { deepFreeze } from "../model/schema.js";
import { dnsRulesSchema } from "../model/dns.js";
import { validateSurgeGeneral, type SurgeGeneral, type SurgeHost } from "../model/surge-schema.js";
import type {
  DeepReadonly,
  Profile,
  ProfileDefinition,
  ProfileProxy,
  ProxyGroupDefinition,
  RouteDefinition,
} from "../model/profile-types.js";
import type { DnsRule } from "../model/types.js";
export type * from "../model/profile-types.js";
const fail = (code: string): never => {
  throw new ProfileDefinitionError(code);
};
/** Keep aliases across nodes, groups and destinations; reject accessors before cloning. */
export function snapshotProfile<T>(input: T): DeepReadonly<T> {
  inspectDefinition(input);
  return deepFreeze(structuredClone(input)) as DeepReadonly<T>;
}
export function defineProfile(input: ProfileDefinition | Profile): Profile {
  inspectDefinition(input);
  exactDefinition(input, [
    "target",
    "proxies",
    "groups",
    "routes",
    "fallback",
    "surge",
    "singBox",
    "mihomo",
    "dns",
  ]);
  exactDefinition(input.target, ["engine", "platform", "version"]);
  if (input.surge !== undefined)
    exactDefinition(input.surge, ["managed", "general", "hosts", "names"]);
  if (input.singBox !== undefined) {
    exactDefinition(input.singBox, [
      "mode",
      "listener",
      "tun",
      "domainMatching",
      "serverAliases",
      "cacheFile",
      "unsupportedUdp",
    ]);
    if (
      input.singBox.mode !== undefined &&
      !["fragment", "standalone"].includes(input.singBox.mode)
    )
      fail("INVALID_PROFILE_DEFINITION");
    if (input.singBox.listener !== undefined)
      exactDefinition(input.singBox.listener, ["port", "resolver"]);
  }
  if (input.mihomo !== undefined) {
    exactDefinition(input.mihomo, ["mode", "listener"]);
    if (input.mihomo.listener) exactDefinition(input.mihomo.listener, ["port", "resolver"]);
  }
  // Inspection above rejects getters/cycles before traversal. Count repeated DAG visits too.
  let remaining = 100000;
  function flatten<T>(fragments: unknown): T[] {
    if (!Array.isArray(fragments)) fail("INVALID_PROFILE_DEFINITION");
    const result: T[] = [];
    function visit(value: unknown): void {
      if (--remaining < 0) fail("DEFINITION_OUTPUT_BUDGET_EXCEEDED");
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
      } else {
        if (!value || typeof value !== "object") fail("INVALID_PROFILE_DEFINITION");
        result.push(value as T);
      }
    }
    visit(fragments);
    return result;
  }
  const proxies = flatten<DeepReadonly<ProfileProxy>>(input.proxies);
  const groups = flatten<DeepReadonly<ProxyGroupDefinition>>(input.groups);
  const routes = flatten<DeepReadonly<RouteDefinition>>(input.routes);
  const dns = input.dns === undefined ? undefined : flatten<DnsRule>(input.dns);
  if (dns) {
    const checked = dnsRulesSchema.safeParse(dns);
    if (!checked.success)
      fail(
        checked.error.issues.some((issue) => issue.message === "DNS_RULE_CONFLICT")
          ? "DNS_RULE_CONFLICT"
          : "INVALID_DNS_RULES",
      );
  }
  let surge: Profile["surge"];
  if (input.surge !== undefined) {
    let general: SurgeGeneral | undefined;
    if (input.surge.general !== undefined) {
      general = {};
      const checked = new Set<object>();
      const costs = new Map<object, number>();
      let validationRemaining = 100000;
      function cost(value: unknown): number {
        if (!value || typeof value !== "object") return 1;
        const cached = costs.get(value);
        if (cached !== undefined) return cached;
        let total = 1;
        for (const item of Object.values(value)) {
          total += cost(item);
          if (total > 100000) fail("DEFINITION_OUTPUT_BUDGET_EXCEEDED");
        }
        costs.set(value, total);
        return total;
      }
      const fragments = Array.isArray(input.surge.general)
        ? input.surge.general
        : [input.surge.general];
      for (const fragment of flatten<DeepReadonly<SurgeGeneral>>(fragments)) {
        if (!checked.has(fragment)) {
          validationRemaining -= cost(fragment);
          if (validationRemaining < 0) fail("DEFINITION_OUTPUT_BUDGET_EXCEEDED");
          if (!validateSurgeGeneral(fragment)) fail("INVALID_SURGE_GENERAL");
          checked.add(fragment);
        }
        Object.assign(general, fragment);
      }
    }
    surge = {
      ...input.surge,
      ...(general === undefined ? {} : { general }),
      ...(input.surge.hosts === undefined
        ? {}
        : { hosts: flatten<DeepReadonly<SurgeHost>>(input.surge.hosts) }),
    } as Profile["surge"];
  }
  if (dns?.length && surge?.hosts?.length) {
    if (dns.length + surge.hosts.length > 2000) fail("INVALID_SURGE_HOSTS");
    const patterns = new Map(dns.map((entry, index) => [entry.pattern.toLowerCase(), index]));
    for (const [index, host] of surge.hosts.entries()) {
      if (typeof host?.pattern !== "string") fail("INVALID_SURGE_HOSTS");
      const dnsIndex = patterns.get(host.pattern.toLowerCase());
      if (dnsIndex !== undefined)
        throw new ProfileDefinitionError("DNS_HOSTS_CONFLICT", [
          `dns[${dnsIndex}]`,
          `surge.hosts[${index}]`,
        ]);
    }
  }
  const {
    dns: _dns,
    surge: _surge,
    proxies: _proxies,
    groups: _groups,
    routes: _routes,
    ...rest
  } = input;
  return snapshotProfile({
    ...rest,
    ...(dns === undefined ? {} : { dns }),
    proxies,
    groups,
    routes,
    ...(surge === undefined ? {} : { surge }),
  }) as Profile;
}
