// @concord-file
// @concord-implements docs/feature/build/use-case/publish-device-configs.md
import { defineBuild, record } from "../authoring/build.js";
import type { BuildDefinition } from "../model/build-types.js";
export type { BuildContext, BuildDefinition } from "../model/build-types.js";
export { defineBuild } from "../authoring/build.js";
import { join, resolve } from "node:path";
import type { Profile, ProfileDefinition } from "../authoring/profile.js";
import { prepareProfile, renderPrepared, type PreparedProfile } from "./plans.js";
import { RenderError } from "../model/errors.js";
import { pathsOverlap } from "../model/paths.js";
import { secretReader, secretFailure } from "./secrets.js";
import { publishProfiles, SurgePublishError } from "./publish.js";
export type BuildResult = {
  published: boolean;
  exitCode: 0 | 1 | 2;
  code: string;
  active?: string;
  hint?: string;
};
import type { Secret, Diagnostic } from "../model/types.js";
function compileBatch(
  profiles: Readonly<Record<string, Profile | ProfileDefinition>>,
  output?: string,
) {
  const entries = Object.entries(profiles);
  const compiled: PreparedProfile[] = [];
  let outputDirectoryChecked = false;
  const result = (code: string, paths?: readonly string[]) => ({
    ...(paths ? { paths } : {}),
    ok: code === "CHECKED",
    code,
    entries,
    compiled,
    outputDirectoryChecked,
  });
  if (
    !entries.length ||
    entries.length > 16 ||
    entries.some(([id]) => !/^[a-z0-9][a-z0-9-]*$/.test(id))
  )
    return result("INVALID_PROFILE_FILENAMES");
  compiled.push(...entries.map(([, profile]) => prepareProfile(profile)));
  const invalid = compiled.find((profile) => !profile.ok);
  if (invalid) return result(invalid.code ?? "COMPILATION_FAILED", invalid.paths);
  if (output !== undefined) {
    outputDirectoryChecked = true;
    if (
      compiled.some((profile) =>
        profile.plan?.model.endpoints.some((endpoint) =>
          pathsOverlap(output, endpoint.stateDirectory),
        ),
      )
    )
      return result("ENDPOINT_STATE_OVERLAP");
  }
  return result("CHECKED");
}
export type ProfileCheckResult = {
  readonly ok: boolean;
  readonly code: string;
  readonly profileCount: number;
  readonly outputDirectoryChecked: boolean;
  readonly profiles: readonly {
    readonly id: string;
    readonly engine: "surge" | "sing-box" | "mihomo" | "stash";
    readonly ok: boolean;
    readonly code?: string;
    readonly paths?: readonly string[];
    readonly diagnostics: readonly Diagnostic[];
  }[];
};
// @concord-code
// @concord-implements docs/feature/build/format/project-config.md
export function checkBuild(input: BuildDefinition): ProfileCheckResult {
  const root = process.cwd();
  let definition: BuildDefinition;
  try {
    definition = defineBuild(input);
  } catch {
    return {
      ok: false,
      code: "INVALID_BUILD_DEFINITION",
      profileCount: 0,
      outputDirectoryChecked: false,
      profiles: [],
    };
  }
  const checked = compileBatch(
    definition.profiles,
    definition.outDir === undefined ? undefined : resolve(root, definition.outDir),
  );
  return {
    ok: checked.ok,
    code: checked.code,
    profileCount: checked.entries.length,
    outputDirectoryChecked: checked.outputDirectoryChecked,
    profiles: checked.compiled.map((profile, index) => ({
      id: checked.entries[index]![0],
      engine: profile.engine,
      ok: profile.ok,
      ...(profile.code ? { code: profile.code, paths: profile.paths } : {}),
      diagnostics: profile.diagnostics,
    })),
  };
}
async function publish(
  profiles: Readonly<Record<string, Profile | ProfileDefinition>>,
  output: string,
  readSecret: (token: Secret) => string | undefined,
): Promise<BuildResult> {
  try {
    const checked = compileBatch(profiles, output);
    if (!checked.ok)
      return {
        published: false,
        exitCode: 1,
        code: checked.code,
        ...(checked.paths ? { paths: checked.paths } : {}),
      };
    const { entries, compiled } = checked;
    const read = secretReader(readSecret);
    const files = new Map<string, string>();
    for (const [index, profile] of compiled.entries()) {
      files.set(
        `${entries[index]![0]}.${profile.engine === "surge" ? "conf" : profile.engine === "sing-box" ? "json" : "yaml"}`,
        renderPrepared(profile, read),
      );
    }
    await publishProfiles(files, output);
    return {
      published: true,
      exitCode: 0,
      code: "PUBLISHED",
      active: join(resolve(output), "out"),
    };
  } catch (error) {
    if (error instanceof SurgePublishError)
      return {
        published: error.published,
        exitCode: error.published || error.message === "PUBLISH_RECOVERY_REQUIRED" ? 2 : 1,
        code: error.message,
        ...(error.published ? { active: join(resolve(output), "out") } : {}),
        ...(error.message === "PUBLISH_RECOVERY_REQUIRED"
          ? {
              hint: "out may be absent; preserve the lock, backup, generation and temporary pointer for manual recovery",
            }
          : {}),
      };
    return {
      published: false,
      exitCode: 1,
      code: error instanceof RenderError ? error.code : "BUILD_FAILED",
      ...secretFailure(error),
    };
  }
}
export type ProfileBuildResult = BuildResult & {
  readonly warnings: Readonly<Record<string, number>>;
  readonly validation: boolean;
  readonly profileCount: number;
};
export function profileBuildFailure(
  code: string,
  validation = false,
  profileCount = 0,
): ProfileBuildResult {
  return { published: false, exitCode: 1, code, warnings: {}, validation, profileCount };
}
/** Pure orchestration result; the CLI owns stdout and process exit status. */
export async function runBuild(
  input: BuildDefinition,
  output: string,
  options: { readonly validation?: boolean } = {},
): Promise<ProfileBuildResult> {
  const root = process.cwd();
  let validation: boolean;
  try {
    record(options, ["validation"]);
    if (options.validation !== undefined && typeof options.validation !== "boolean")
      throw new Error();
    validation = options.validation ?? false;
  } catch {
    return profileBuildFailure("INVALID_BUILD_OPTIONS");
  }
  let definition: BuildDefinition;
  try {
    definition = defineBuild(input);
  } catch {
    return profileBuildFailure("INVALID_BUILD_DEFINITION", validation);
  }
  const profileCount = Object.keys(definition.profiles).length;
  const failure = (code: string) => profileBuildFailure(code, validation, profileCount);
  if (typeof output !== "string" || !output.trim()) return failure("INVALID_OUTPUT_DIRECTORY");
  output = resolve(root, output);
  if (validation && !definition.secrets) return failure("VALIDATION_SECRETS_REQUIRED");
  const warnings: Record<string, number> = {};
  const context = Object.freeze({ validation });
  const readSecret = definition.secrets;
  const result = await publish(
    definition.profiles,
    output,
    readSecret ? (token) => readSecret(token, context) : (token) => process.env[token.name],
  );
  return { ...result, warnings, validation, profileCount };
}

export { definitionDiagnostic } from "../model/definitions.js";
export { targetCatalog } from "../targets/catalog.js";
