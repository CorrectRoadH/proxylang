// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/build-targets.md
import { validateRuleSets } from "./rulesets.js";
import type { Diagnostic, Entry } from "./types.js";
import { dnsRulesSchema } from "./dns.js";
import type { DnsRule } from "./types.js";
import { isIP } from "node:net";
import { compile, type Compilation } from "./compiler.js";
import { deepFreeze, matchSchema } from "./schema.js";
import {
  compileSurgeProfile,
  validateSurgeGeneral,
  type SurgeGeneral,
  type SurgeHost,
  type SurgeCondition,
  type SurgeProfileInput,
  type SurgeTunnel,
  type SurgeProfileCompilation,
} from "./surge-profile.js";
import {
  lowerSurgeProfile,
  exactDefinition,
  inspectDefinition,
  snapshotDefinition,
  ProfileDefinitionError,
  type ProxyGroupDefinition,
  type RouteDefinition,
} from "./surge-definitions.js";
import type { Action, Group, Match, ProxyNode, TailscaleEndpoint, Target } from "./types.js";

export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export type ProfileCondition =
  | Exclude<Match | SurgeCondition, { type: "all" | "any" | "not" }>
  | {
      readonly type: "all" | "any";
      readonly conditions: readonly ProfileCondition[];
      readonly noResolve?: boolean;
    }
  | {
      readonly type: "not";
      readonly condition: ProfileCondition;
      readonly noResolve?: boolean;
    };
export type ProfileDestination =
  | string
  | ProxyNode
  | ProxyGroupDefinition
  | SurgeTunnel
  | TailscaleEndpoint
  | { readonly builtin: "DIRECT" | "REJECT" | "REJECT-DROP" | "REJECT-NO-DROP" | "REJECT-TINYGIF" };
export type Fragments<T> = readonly (T | Fragments<T>)[];
export type ProfileProxy = ProxyNode | SurgeTunnel | TailscaleEndpoint;
export type SurgeConfig = DeepReadonly<Pick<SurgeProfileInput, "managed" | "names">> & {
  readonly general?: DeepReadonly<SurgeGeneral> | Fragments<DeepReadonly<SurgeGeneral>>;
  readonly hosts?: Fragments<DeepReadonly<SurgeHost>>;
};
export type ProfileDefinition = {
  readonly dns?: Fragments<DnsRule>;
  readonly target:
    | SurgeProfileInput["target"]
    | {
        readonly engine: "sing-box";
        readonly platform: "macos" | "linux";
        readonly version: string;
      };
  readonly proxies: Fragments<ProfileProxy>;
  readonly groups: Fragments<ProxyGroupDefinition>;
  readonly routes: Fragments<RouteDefinition>;
  readonly fallback: ProfileDestination;
  readonly surge?: SurgeConfig;
  readonly singBox?: {
    readonly mode: "fragment" | "standalone";
    readonly listener?: { readonly port: number; readonly resolver: string };
  };
};
export type Profile = DeepReadonly<
  Omit<ProfileDefinition, "proxies" | "groups" | "routes" | "surge" | "dns"> & {
    readonly dns?: readonly DnsRule[];
    readonly proxies: readonly ProfileProxy[];
    readonly groups: readonly ProxyGroupDefinition[];
    readonly routes: readonly RouteDefinition[];
    readonly surge?: Pick<SurgeProfileInput, "managed" | "general" | "hosts" | "names">;
  }
>;
export type ProfileCompilation =
  | {
      readonly engine: "surge";
      readonly ok: boolean;
      readonly compilation: SurgeProfileCompilation;
    }
  | { readonly engine: "sing-box"; readonly ok: boolean; readonly compilation: Compilation }
  | { readonly engine: "invalid"; readonly ok: false; readonly code: string };
const fail = (code: string): never => {
  throw new ProfileDefinitionError(code);
};
/** Keep aliases across nodes, groups and destinations; reject accessors before cloning. */
export function snapshotProfile<T>(input: T): DeepReadonly<T> {
  inspectDefinition(input);
  return deepFreeze(structuredClone(input)) as DeepReadonly<T>;
}
export function surgeConfig(input: SurgeConfig): SurgeConfig {
  inspectDefinition(input);
  exactDefinition(input, ["managed", "general", "hosts", "names"]);
  return snapshotProfile(input as unknown) as SurgeConfig;
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
    "dns",
  ]);
  exactDefinition(input.target, ["engine", "platform", "version"]);
  if (input.surge !== undefined)
    exactDefinition(input.surge, ["managed", "general", "hosts", "names"]);
  if (input.singBox !== undefined) {
    exactDefinition(input.singBox, ["mode", "listener"]);
    if (!["fragment", "standalone"].includes(input.singBox.mode))
      fail("INVALID_PROFILE_DEFINITION");
    if (input.singBox.listener !== undefined)
      exactDefinition(input.singBox.listener, ["port", "resolver"]);
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
  if (dns?.length && surge?.hosts?.length) fail("DNS_HOSTS_CONFLICT");
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
function isEndpoint(
  proxy: DeepReadonly<ProfileProxy>,
): proxy is DeepReadonly<SurgeTunnel | TailscaleEndpoint> {
  return ["wireguard", "tailscale", "sing-box-tailscale"].includes(proxy.type);
}

function surgeCondition(condition: ProfileCondition, depth = 0): SurgeCondition {
  if (depth > 10) return fail("LOGICAL_DEPTH_EXCEEDED");
  if (condition.type === "nativeRuleSet" || (condition.type === "ruleSet" && "when" in condition)) {
    const parsed = matchSchema.safeParse(condition);
    if (!parsed.success) return fail("PROFILE_CONDITION_UNSUPPORTED");
    const value = parsed.data;
    if (value.type === "ruleSet") return surgeCondition(value.when, depth);
    if (value.type !== "nativeRuleSet" || value.engine !== "surge")
      return fail("PROFILE_CONDITION_UNSUPPORTED");
    if (depth > 0 && value.intervalSeconds !== undefined)
      return fail("RULESET_COMPOSITION_UNSUPPORTED");
    return {
      type: "ruleSet",
      format: value.format,
      url: value.url,
      ...(value.intervalSeconds !== undefined ? { intervalSeconds: value.intervalSeconds } : {}),
      ...(value.noResolve !== undefined ? { noResolve: value.noResolve } : {}),
      ...(value.includeSniffed !== undefined ? { includeSniffed: value.includeSniffed } : {}),
    };
  }
  if (condition.type === "all" || condition.type === "any") {
    if (!Array.isArray(condition.conditions)) return fail("PROFILE_CONDITION_UNSUPPORTED");
    if (condition.conditions.length === 1) {
      exactDefinition(condition, ["type", "conditions"]);
      return surgeCondition(condition.conditions[0]!, depth + 1);
    }
    return {
      ...condition,
      conditions: condition.conditions.map((child) => surgeCondition(child, depth + 1)),
    };
  }
  if (condition.type === "not")
    return { ...condition, condition: surgeCondition(condition.condition, depth + 1) };
  if (condition.type === "ipCidr" && isIP(condition.value.split("/")[0]!) === 6)
    return { ...condition, type: "ipCidr6" };
  return condition as SurgeCondition;
}
/** No secrets or I/O. All engine adaptations retain strict validation. */
export function compileProfile(input: ProfileDefinition | Profile): ProfileCompilation {
  try {
    const profile = defineProfile(input);
    // Budget the eventual expansion before any recursive lowering, without losing aliases.
    snapshotDefinition(profile.routes.map((route) => route.when));
    const ruleSets: Entry[] = [];
    const collectRuleSets = (condition: ProfileCondition): void => {
      if (
        condition.type === "nativeRuleSet" ||
        (condition.type === "ruleSet" && "when" in condition)
      ) {
        const parsed = matchSchema.safeParse(condition);
        if (!parsed.success) return fail("PROFILE_CONDITION_UNSUPPORTED");
        ruleSets.push({
          type: "rule",
          id: `ruleset-${ruleSets.length}`,
          when: parsed.data,
          then: { type: "direct" },
        });
      } else if (condition.type === "all" || condition.type === "any")
        condition.conditions.forEach(collectRuleSets);
      else if (condition.type === "not") collectRuleSets(condition.condition);
    };
    profile.routes.forEach((route) => collectRuleSets(route.when));
    const ruleSetDiagnostics: Diagnostic[] = [];
    validateRuleSets(ruleSets, profile.target.engine, ruleSetDiagnostics, "routes");
    const ruleSetError = ruleSetDiagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (ruleSetError) return fail(ruleSetError.code);
    const nodes = profile.proxies.filter(
      (proxy): proxy is DeepReadonly<ProxyNode> => !isEndpoint(proxy),
    );
    const endpoints = profile.proxies.filter(isEndpoint);
    if (profile.target.engine === "surge") {
      if (profile.singBox !== undefined) fail("PROFILE_EXTENSION_UNSUPPORTED");
      if (endpoints.some((endpoint) => endpoint.type === "sing-box-tailscale"))
        fail("PROFILE_ENDPOINT_UNSUPPORTED");
      const lowered = lowerSurgeProfile({
        target: profile.target,
        ...profile.surge,
        ...(profile.dns?.length ? { hosts: profile.dns } : {}),
        nodes,
        tunnels: endpoints,
        groups: profile.groups,
        routes: profile.routes.map((route) => ({ ...route, when: surgeCondition(route.when) })),
        fallback: profile.fallback,
      } as Parameters<typeof lowerSurgeProfile>[0]);
      const compilation = compileSurgeProfile(lowered);
      return { engine: "surge", ok: compilation.ok, compilation };
    }
    if (profile.target.engine !== "sing-box") return fail("PROFILE_TARGET_UNSUPPORTED");
    if (profile.surge !== undefined) fail("PROFILE_EXTENSION_UNSUPPORTED");
    if (endpoints.some((endpoint) => endpoint.type !== "sing-box-tailscale"))
      fail("PROFILE_ENDPOINT_UNSUPPORTED");
    const registry = new Map<string, object>();
    for (const resource of [...profile.proxies, ...profile.groups]) {
      if (!resource || typeof resource.id !== "string") fail("INVALID_RESOURCE_DEFINITION");
      if (registry.has(resource.id)) fail("DUPLICATE_RESOURCE_ID");
      registry.set(resource.id, resource);
    }
    const lower = (destination: DeepReadonly<ProfileDestination>): Action => {
      if (typeof destination === "string") {
        if (!registry.has(destination)) return fail("UNKNOWN_DESTINATION_ID");
        return { type: "route", to: destination };
      }
      if (!destination || typeof destination !== "object") return fail("INVALID_DESTINATION");
      if ("builtin" in destination) {
        exactDefinition(destination, ["builtin"]);
        if (destination.builtin === "DIRECT") return { type: "direct" };
        if (destination.builtin === "REJECT") return { type: "reject" };
        return fail("PROFILE_DESTINATION_UNSUPPORTED");
      }
      if (registry.get(destination.id) !== destination) fail("UNREGISTERED_DESTINATION_INSTANCE");
      return { type: "route", to: destination.id };
    };
    const groups = profile.groups.map((definition): Group => {
      exactDefinition(definition, [
        "type",
        "id",
        "name",
        "algorithm",
        "members",
        "url",
        "intervalSeconds",
        "timeoutSeconds",
      ]);
      if (
        definition.type !== "proxy-group" ||
        typeof definition.name !== "string" ||
        !definition.name.trim()
      )
        fail("INVALID_GROUP_DEFINITION");
      if (
        definition.url !== undefined ||
        definition.intervalSeconds !== undefined ||
        definition.timeoutSeconds !== undefined
      )
        fail("PROFILE_GROUP_OPTIONS_UNSUPPORTED");
      exactDefinition(
        definition.algorithm,
        definition.algorithm.type === "urltest"
          ? ["type", "url", "intervalSeconds", "toleranceMs"]
          : ["type"],
      );
      const members = definition.members.map((member) => {
        const action = lower(member);
        if (action.type !== "route") return fail("PROFILE_GROUP_MEMBER_UNSUPPORTED");
        return action.to;
      });
      return { ...definition.algorithm, id: definition.id, members } as Group;
    });
    const routing = profile.routes.map((route, index) => {
      exactDefinition(route, ["type", "when", "to"]);
      if (route.type !== "route") fail("INVALID_ROUTE_DEFINITION");
      return {
        type: "rule" as const,
        id: `route-${index + 1}`,
        when: route.when as Match,
        then: lower(route.to),
      };
    });
    const compilation = compile(
      snapshotDefinition({
        programs: {
          profile: {
            engine: "sing-box",
            ...(profile.dns === undefined ? {} : { dns: profile.dns }),
            nodes,
            endpoints: endpoints as readonly TailscaleEndpoint[],
            groups,
            routing,
            fallback: lower(profile.fallback),
            ...(profile.singBox?.listener ? { listener: profile.singBox.listener } : {}),
          },
        },
        targets: [
          {
            ...profile.target,
            id: "profile",
            program: "profile",
            mode: profile.singBox?.mode ?? "fragment",
          } as Target,
        ],
      }),
    );
    return { engine: "sing-box", ok: compilation.ok, compilation };
  } catch (error) {
    return {
      engine: "invalid",
      ok: false,
      code: error instanceof ProfileDefinitionError ? error.code : "INVALID_PROFILE_DEFINITION",
    };
  }
}
