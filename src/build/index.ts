// @concord-file
// @concord-implements docs/feature/build/library.md
import { join, resolve } from "node:path";
import { ProfileDefinitionError } from "../model/definitions.js";
import { kindOf, originOf } from "../model/identity.js";
import type { BuildDefinition } from "../model/build-types.js";
import type { Target } from "../model/profile-types.js";
import type { Diagnostic, ProfileDiagnostic } from "../model/types.js";
import type { Selection } from "../model/inspect-profile.js";
import { prepareProfile, renderPrepared } from "./plans.js";
import { pathsOverlap } from "../model/paths.js";
import { secretReader, secretFailure } from "./secrets.js";
import { publishProfiles, SurgePublishError } from "./publish.js";
import { RenderError } from "../model/errors.js";
export { defineBuild } from "../authoring/build.js";
export type { BuildDefinition };
export type { Origin } from "../model/identity.js";
export type { Selection };
export type CheckResult = {
  readonly ok: boolean;
  readonly code: "CHECKED" | "CHECK_FAILED" | "CASE_FAILED";
  readonly outputDirectoryChecked: boolean;
  readonly profiles: readonly {
    readonly key: string;
    readonly target: Target;
    readonly ok: boolean;
    readonly diagnostics: readonly ProfileDiagnostic[];
    readonly selections: readonly Selection[];
  }[];
  readonly cases: readonly never[];
};
export type BuildResult = {
  readonly published: boolean;
  readonly exitCode: 0 | 1 | 2;
  readonly code: string;
  readonly check: CheckResult;
  readonly active?: string;
  readonly hint?: string;
  readonly secretName?: string;
};
function compile(definition: BuildDefinition) {
  if (kindOf(definition) !== "build") throw new ProfileDefinitionError("INVALID_BUILD_DEFINITION");
  const entries = Object.entries(definition.profiles);
  const prepared = entries.map(([key, p]) => prepareProfile(p, key, definition.secrets));
  const extra = entries.map(() => [] as Diagnostic[]);
  const endpoints = entries.flatMap(([key, p], index) =>
    p.proxies.flatMap((resource) =>
      resource.type === "sing-box-tailscale" ? [{ key, index, resource }] : [],
    ),
  );
  for (let i = 0; i < endpoints.length; i++) {
    const a = endpoints[i]!;
    const add = (index: number, key: string, resource: typeof a.resource) =>
      extra[index]!.push({
        severity: "error",
        code: "ENDPOINT_STATE_OVERLAP",
        profile: key,
        path: `proxies.${resource.id}.stateDirectory`,
        message: "Endpoint state directories must be exclusive",
        origin: originOf(resource),
      });
    if (
      definition.outDir !== undefined &&
      pathsOverlap(resolve(definition.outDir), a.resource.stateDirectory)
    )
      add(a.index, a.key, a.resource);
    for (let j = 0; j < i; j++) {
      const b = endpoints[j]!;
      if (pathsOverlap(a.resource.stateDirectory, b.resource.stateDirectory)) {
        add(a.index, a.key, a.resource);
        add(b.index, b.key, b.resource);
      }
    }
  }
  const profiles = prepared.map((p, i) => {
    const diagnostics = [...p.diagnostics, ...extra[i]!].map((d) => {
      const { target: _target, ...rest } = d;
      return { ...rest, profile: entries[i]![0] };
    });
    return {
      key: entries[i]![0],
      target: entries[i]![1].target,
      ok: p.ok && !diagnostics.some((d) => d.severity === "error"),
      diagnostics,
      selections: p.selections,
    };
  });
  const ok = profiles.every((p) => p.ok);
  const check: CheckResult = Object.freeze({
    ok,
    code: ok ? "CHECKED" : "CHECK_FAILED",
    outputDirectoryChecked: definition.outDir !== undefined,
    profiles,
    cases: [],
  });
  return { check, prepared, entries };
}
export function checkBuild(definition: BuildDefinition): CheckResult {
  return compile(definition).check;
}
export async function runBuild(
  definition: BuildDefinition,
  options: { readonly validation?: boolean } = {},
): Promise<BuildResult> {
  const { check, prepared, entries } = compile(definition);
  if (
    Object.keys(options).some((k) => k !== "validation") ||
    (options.validation !== undefined && typeof options.validation !== "boolean")
  )
    return { published: false, exitCode: 1, code: "INVALID_BUILD_OPTIONS", check };
  if (!check.ok) return { published: false, exitCode: 1, code: check.code, check };
  if (definition.outDir === undefined)
    return { published: false, exitCode: 1, code: "OUTPUT_DIRECTORY_REQUIRED", check };
  const output = resolve(definition.outDir);
  const active = join(output, "out");
  try {
    const read = secretReader(definition.secrets, options.validation ?? false);
    const files = new Map<string, string>();
    for (const [i, p] of prepared.entries())
      files.set(
        `${entries[i]![0]}.${p.engine === "surge" ? "conf" : p.engine === "sing-box" ? "json" : "yaml"}`,
        renderPrepared(p, read),
      );
    await publishProfiles(files, output);
    return { published: true, exitCode: 0, code: "PUBLISHED", check, active };
  } catch (error) {
    if (error instanceof SurgePublishError)
      return {
        published: error.published,
        exitCode: error.published || error.message === "PUBLISH_RECOVERY_REQUIRED" ? 2 : 1,
        code: error.message,
        check,
        ...(error.published ? { active } : {}),
        ...(error.message === "PUBLISH_RECOVERY_REQUIRED"
          ? {
              hint: "Preserve the lock, backup, generation and temporary pointer for manual recovery",
            }
          : {}),
      };
    return {
      published: false,
      exitCode: 1,
      code: error instanceof RenderError ? error.code : "BUILD_FAILED",
      check,
      ...secretFailure(error),
    };
  }
}
export { definitionDiagnostic } from "../model/definitions.js";
export { targetCatalog } from "../targets/catalog.js";
