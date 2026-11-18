// @concord-file
// @concord-implements docs/feature/targets/README.md#编码规则
// @concord-implements docs/feature/targets/use-case/check-device-target.md
import { diagnosticView } from "../model/diagnostic-view.js";
import { normalizeRouting, type RoutingModel } from "../model/routing-model.js";
import { stringify } from "yaml";
import { defineProfile } from "../authoring/profile.js";
import { inspectProfile, type Selection } from "../model/inspect-profile.js";
import type { RuleSet, Secrets } from "../model/profile-types.js";
import { originOf } from "../model/identity.js";
import { snapshotDefinition, ProfileDefinitionError } from "../model/definitions.js";
import { normalizeProfile } from "../model/normalize.js";
import type { Profile } from "../model/profile-types.js";
import type { Diagnostic, EnginePlan, Secret } from "../model/types.js";
import {
  compileSurgeProfile,
  renderSurgeProfiles,
  type SurgeProfileCompilation,
} from "../engines/surge/profile.js";
import { normalizeSurgeProfile } from "../model/normalize-surge.js";
import { singbox } from "../engines/sing-box/render.js";
import { clashConfig as mihomo } from "../engines/mihomo/render.js";
import { clashConfig as stash } from "../engines/stash/render.js";
import { engineChecks as singBoxChecks } from "../engines/sing-box/check.js";
import { engineChecks as mihomoChecks } from "../engines/mihomo/check.js";
import { engineChecks as stashChecks } from "../engines/stash/check.js";
import { checkTarget } from "../targets/check.js";
import { targetCatalog } from "../targets/catalog.js";
export type PreparedProfile = {
  engine: Profile["target"]["engine"];
  selections: readonly Selection[];
  routing?: RoutingModel;
  ruleSets?: ReadonlyMap<RuleSet, string>;
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  native?: SurgeProfileCompilation;
  plan?: EnginePlan;
  code?: string;
  paths?: readonly string[];
};
export function prepareProfile(
  input: Profile,
  key: string,
  secrets?: Secrets,
  checkSecrets = true,
): PreparedProfile {
  let engine: Profile["target"]["engine"] = "surge";
  const collected: Diagnostic[] = [];
  let selections: readonly Selection[] = [];
  let ruleSets: ReadonlyMap<RuleSet, string> | undefined;
  try {
    const p = defineProfile(input);
    engine = p.target.engine;
    snapshotDefinition(p.routes.map((r) => r.when));
    const inspected = inspectProfile(p, key, secrets, checkSecrets);
    selections = inspected.selections;
    const routing = normalizeRouting(p, inspected);
    ruleSets = routing.ruleSets;
    collected.push(...inspected.diagnostics);
    const invalid = collected.some((d) => d.severity === "error");
    const view = invalid
      ? diagnosticView(p, inspected)
      : ({ ...p, routes: inspected.rules } as unknown as Profile);
    const project = (d: Diagnostic): Diagnostic => ({
      ...d,
      code: diagnosticCode(d.code),
      profile: key,
      origin: d.origin ?? diagnosticOrigin(p, d.path),
    });
    const supportedTarget = targetCatalog.find(
      (d) => d.engine === engine && (d.platforms as readonly string[]).includes(p.target.platform),
    );
    if (supportedTarget?.version !== p.target.version)
      return {
        engine,
        selections,
        ruleSets,
        ok: false,
        diagnostics: [
          ...collected,
          {
            severity: "error",
            code: "TARGET_UNSUPPORTED",
            profile: key,
            origin: originOf(p),
            path: supportedTarget ? "target.version" : "target",
            message: supportedTarget
              ? `${engine} ${p.target.platform} 只支持最新稳定版 ${supportedTarget.version}`
              : "Unsupported exact target",
          },
        ],
      };
    const allDiagnostics = (ds: readonly Diagnostic[]) => {
      const seen = new Set<string>();
      return [...collected, ...ds.map(project)].filter((d) => {
        const key = JSON.stringify([d.code, d.path]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    if (
      (p.surge && engine !== "surge") ||
      (p.singBox && engine !== "sing-box") ||
      (p.mihomo && engine !== "mihomo")
    )
      throw new ProfileDefinitionError("PROFILE_EXTENSION_UNSUPPORTED");
    if (engine === "surge") {
      const lowered = normalizeSurgeProfile(view);
      const native = compileSurgeProfile(lowered);
      return {
        engine,
        selections,
        ruleSets,
        ok: native.ok && !collected.some((d) => d.severity === "error"),
        diagnostics: allDiagnostics(native.diagnostics),
        ...(!invalid && native.ok ? { native, routing } : {}),
      };
    }
    const model = normalizeProfile(view);
    const checks = (
      engine === "sing-box" ? singBoxChecks : engine === "mihomo" ? mihomoChecks : stashChecks
    )(model);
    const result = checkTarget(model, checks);
    return {
      engine,
      selections,
      ruleSets,
      ok: result.ok && !collected.some((d) => d.severity === "error"),
      diagnostics: allDiagnostics(result.diagnostics),
      ...(!invalid && result.ok
        ? {
            plan: { ...result.plan, names: inspected.names },
            routing,
          }
        : {}),
    };
  } catch (e) {
    return {
      engine,
      selections,
      ruleSets,
      ok: false,
      code: e instanceof ProfileDefinitionError ? e.code : "INVALID_PROFILE_DEFINITION",
      paths: e instanceof ProfileDefinitionError ? e.paths : undefined,
      diagnostics: [
        ...collected,
        {
          severity: "error",
          code: diagnosticCode(e instanceof ProfileDefinitionError ? e.code : "INVALID_FIELD"),
          profile: key,
          path: e instanceof ProfileDefinitionError ? (e.paths?.[0] ?? "$") : "$",
          message: "Profile validation failed",
          origin: originOf(input),
        },
      ],
    };
  }
}
export function renderPrepared(prepared: PreparedProfile, read: (s: Secret) => string): string {
  if (!prepared.ok) throw new Error("INVALID_PLAN");
  if (prepared.native) return renderSurgeProfiles([prepared.native], read)[0]!.content;
  const plan = prepared.plan!;
  return prepared.engine === "sing-box"
    ? JSON.stringify(singbox(plan, read), null, 2) + "\n"
    : stringify(prepared.engine === "mihomo" ? mihomo(plan, read) : stash(plan, read));
}

function diagnosticCode(code: string): string {
  return (
    (
      {
        UNKNOWN_TARGET: "TARGET_UNSUPPORTED",
        INVALID_NATIVE_NAME: "NAME_UNSAFE",
        MISSING_REFERENCE: "UNLISTED_EXIT",
        RESOURCE_CYCLE: "GROUP_CYCLE",
        GROUP_CYCLE: "GROUP_CYCLE",
        DUPLICATE_RESOURCE: "DUPLICATE_ID",
        DUPLICATE_RESOURCE_ID: "DUPLICATE_ID",
        NETWORK_UNSUPPORTED: "TCP_ONLY_EXIT",
        GROUP_UNSUPPORTED: "GROUP_ALGORITHM_UNSUPPORTED",
        UNSUPPORTED_GROUP_ALGORITHM: "GROUP_ALGORITHM_UNSUPPORTED",
        GROUP_BUILTIN_UNSUPPORTED: "MEMBER_TYPE_UNSUPPORTED",
        ENDPOINT_REFERENCE_UNSUPPORTED: "MEMBER_TYPE_UNSUPPORTED",
        PROFILE_GROUP_MEMBER_UNSUPPORTED: "MEMBER_TYPE_UNSUPPORTED",
        SMART_MEMBER_UNSUPPORTED: "MEMBER_TYPE_UNSUPPORTED",
        PLATFORM_RULE_UNSUPPORTED: "CONDITION_UNSUPPORTED",
        RULE_OPTION_UNSUPPORTED: "CONDITION_UNSUPPORTED",
        RULESET_COMPOSITION_UNSUPPORTED: "CONDITION_UNSUPPORTED",
        MATCH_UNSUPPORTED: "CONDITION_UNSUPPORTED",
        MATCH_OPTION_UNSUPPORTED: "CONDITION_UNSUPPORTED",
        PLATFORM_CONDITION_UNSUPPORTED: "CONDITION_UNSUPPORTED",
        PROFILE_CONDITION_UNSUPPORTED: "CONDITION_UNSUPPORTED",
        DNS_MODE_UNSUPPORTED: "DNS_UNSUPPORTED",
        PROFILE_ENDPOINT_UNSUPPORTED: "TUNNEL_UNSUPPORTED",
        ENDPOINT_UNSUPPORTED: "TUNNEL_UNSUPPORTED",
        MODE_UNSUPPORTED: "TARGET_UNSUPPORTED",
      } as Record<string, string>
    )[code] ?? code
  );
}

function diagnosticOrigin(p: Profile, path: string) {
  const route = /^routes\[(\d+)\]/.exec(path);
  if (route) return originOf(p.routes[Number(route[1])]) ?? originOf(p);
  const resource = /^(?:proxies|groups)\.([a-z0-9_-]+)/.exec(path);
  if (resource)
    return originOf([...p.proxies, ...p.groups].find((r) => r.id === resource[1])) ?? originOf(p);
  return originOf(p);
}
