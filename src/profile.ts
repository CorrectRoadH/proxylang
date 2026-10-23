// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/build-targets.md
import { isIP } from "node:net";
import { compile, type Compilation } from "./compiler.js";
import { deepFreeze, matchSchema } from "./schema.js";
import {
  compileSurgeProfile,
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
      readonly extendedMatching?: boolean;
    }
  | {
      readonly type: "not";
      readonly condition: ProfileCondition;
      readonly noResolve?: boolean;
      readonly extendedMatching?: boolean;
    };
export type ProfileDestination =
  | ProxyNode
  | ProxyGroupDefinition
  | SurgeTunnel
  | TailscaleEndpoint
  | { readonly builtin: "DIRECT" | "REJECT" | "REJECT-DROP" | "REJECT-NO-DROP" | "REJECT-TINYGIF" };
export type SurgeConfig = Pick<SurgeProfileInput, "managed" | "general" | "hosts" | "names">;
export type ProfileDefinition = {
  readonly target:
    | SurgeProfileInput["target"]
    | {
        readonly engine: "sing-box";
        readonly platform: "macos" | "linux";
        readonly version: string;
      };
  readonly nodes: readonly ProxyNode[];
  readonly groups: readonly ProxyGroupDefinition[];
  readonly routes: readonly RouteDefinition[];
  readonly fallback: ProfileDestination;
  readonly endpoints?: readonly (SurgeTunnel | TailscaleEndpoint)[];
  readonly surge?: DeepReadonly<SurgeConfig>;
  readonly singBox?: {
    readonly mode: "fragment" | "standalone";
    readonly listener?: { readonly port: number; readonly resolver: string };
  };
};
export type Profile = DeepReadonly<ProfileDefinition>;
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
export function surgeConfig(input: SurgeConfig): DeepReadonly<SurgeConfig> {
  inspectDefinition(input);
  exactDefinition(input, ["managed", "general", "hosts", "names"]);
  return snapshotProfile(input);
}
export function defineProfile(input: ProfileDefinition | Profile): Profile {
  inspectDefinition(input);
  exactDefinition(input, [
    "target",
    "nodes",
    "groups",
    "routes",
    "fallback",
    "endpoints",
    "surge",
    "singBox",
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
  if (
    !Array.isArray(input.nodes) ||
    !Array.isArray(input.groups) ||
    !Array.isArray(input.routes) ||
    (input.endpoints !== undefined && !Array.isArray(input.endpoints))
  )
    fail("INVALID_PROFILE_DEFINITION");
  return snapshotProfile(input);
}
function surgeCondition(condition: ProfileCondition, depth = 0): SurgeCondition {
  if (depth > 10) return fail("LOGICAL_DEPTH_EXCEEDED");
  if (condition.type === "nativeRuleSet" || (condition.type === "ruleSet" && "when" in condition)) {
    const parsed = matchSchema.safeParse(condition);
    if (!parsed.success) return fail("PROFILE_CONDITION_UNSUPPORTED");
    const value = parsed.data;
    if (value.type === "ruleSet") return surgeCondition(value.when, depth);
    if (
      value.type !== "nativeRuleSet" ||
      value.engine !== "surge" ||
      value.intervalSeconds !== undefined
    )
      return fail("PROFILE_CONDITION_UNSUPPORTED");
    return { type: "ruleSet", format: value.format, url: value.url };
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
    if (profile.target.engine === "surge") {
      if (profile.singBox !== undefined) fail("PROFILE_EXTENSION_UNSUPPORTED");
      if (profile.endpoints?.some((endpoint) => endpoint.type === "sing-box-tailscale"))
        fail("PROFILE_ENDPOINT_UNSUPPORTED");
      const lowered = lowerSurgeProfile({
        target: profile.target,
        ...profile.surge,
        nodes: profile.nodes,
        tunnels: profile.endpoints,
        groups: profile.groups,
        routes: profile.routes.map((route) => ({ ...route, when: surgeCondition(route.when) })),
        fallback: profile.fallback,
      } as Parameters<typeof lowerSurgeProfile>[0]);
      const compilation = compileSurgeProfile(lowered);
      return { engine: "surge", ok: compilation.ok, compilation };
    }
    if (profile.target.engine !== "sing-box") return fail("PROFILE_TARGET_UNSUPPORTED");
    if (profile.surge !== undefined) fail("PROFILE_EXTENSION_UNSUPPORTED");
    if (profile.endpoints?.some((endpoint) => endpoint.type !== "sing-box-tailscale"))
      fail("PROFILE_ENDPOINT_UNSUPPORTED");
    const registry = new Map<string, object>();
    for (const resource of [...profile.nodes, ...profile.groups, ...(profile.endpoints ?? [])]) {
      if (!resource || typeof resource.id !== "string") fail("INVALID_RESOURCE_DEFINITION");
      if (registry.has(resource.id)) fail("DUPLICATE_RESOURCE_ID");
      registry.set(resource.id, resource);
    }
    const lower = (destination: DeepReadonly<ProfileDestination>): Action => {
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
            nodes: profile.nodes,
            endpoints: profile.endpoints as readonly TailscaleEndpoint[],
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
