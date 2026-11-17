// @concord-file
// @concord-implements docs/feature/targets/README.md#编码规则
import { stringify } from "yaml";
import { defineProfile } from "../authoring/profile.js";
import { snapshotDefinition, ProfileDefinitionError } from "../model/definitions.js";
import { normalizeProfile } from "../model/normalize.js";
import type { Profile, ProfileDefinition } from "../model/profile-types.js";
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
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  native?: SurgeProfileCompilation;
  plan?: EnginePlan;
  code?: string;
  paths?: readonly string[];
};
export function prepareProfile(input: Profile | ProfileDefinition): PreparedProfile {
  let engine: Profile["target"]["engine"] = "surge";
  try {
    const p = defineProfile(input);
    engine = p.target.engine;
    snapshotDefinition(p.routes.map((r) => r.when));
    const descriptor = targetCatalog.find(
      (d) =>
        d.engine === engine &&
        d.version === p.target.version &&
        (d.platforms as readonly string[]).includes(p.target.platform),
    );
    if (!descriptor)
      return {
        engine,
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: "UNKNOWN_TARGET",
            path: "target",
            message: "Unsupported exact target",
          },
        ],
      };
    if (
      (p.surge && engine !== "surge") ||
      (p.singBox && engine !== "sing-box") ||
      (p.mihomo && engine !== "mihomo")
    )
      throw new ProfileDefinitionError("PROFILE_EXTENSION_UNSUPPORTED");
    if (engine === "surge") {
      const lowered = normalizeSurgeProfile(p);
      const native = compileSurgeProfile(lowered);
      return { engine, ok: native.ok, diagnostics: native.diagnostics, native };
    }
    const model = normalizeProfile(p);
    const checks = (
      engine === "sing-box" ? singBoxChecks : engine === "mihomo" ? mihomoChecks : stashChecks
    )(model);
    const result = checkTarget(model, checks);
    return { engine, ok: result.ok, diagnostics: result.diagnostics, plan: result.plan };
  } catch (e) {
    return {
      engine,
      ok: false,
      code: e instanceof ProfileDefinitionError ? e.code : "INVALID_PROFILE_DEFINITION",
      paths: e instanceof ProfileDefinitionError ? e.paths : undefined,
      diagnostics: [],
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
