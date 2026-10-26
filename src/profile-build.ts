// @concord-file
// @concord-implements docs/feature/artifact-publication/use-case/publish-generation.md
import { ProfileDefinitionError, snapshotDefinition } from "./surge-definitions.js";
import { join, resolve } from "node:path";
import {
  compileProfile,
  snapshotProfile,
  type Profile,
  type ProfileDefinition,
  type ProfileCompilation,
} from "./profile.js";
import { pathsOverlap, RenderError } from "./proxies.js";
import { secretReader, secretFailure } from "./secrets.js";
import { render } from "./render.js";
import { renderSurgeProfiles } from "./surge-profile.js";
import { publishProfiles, SurgePublishError } from "./surge-publish.js";
import type { BuildResult } from "./host.js";
import type { Secret, Diagnostic } from "./types.js";
function compileBatch(
  profiles: Readonly<Record<string, Profile | ProfileDefinition>>,
  output?: string,
) {
  const entries = Object.entries(profiles);
  const compiled: ProfileCompilation[] = [];
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
  compiled.push(...entries.map(([, profile]) => compileProfile(profile)));
  const invalid = compiled.find((profile) => !profile.ok);
  if (invalid)
    return result(
      invalid.engine === "invalid" ? invalid.code : "COMPILATION_FAILED",
      invalid.engine === "invalid" ? invalid.paths : undefined,
    );
  if (output !== undefined) {
    outputDirectoryChecked = true;
    if (
      compiled.some(
        (profile) =>
          profile.engine === "sing-box" &&
          profile.compilation.plans.some((plan) =>
            plan.program.endpoints?.some((endpoint) =>
              pathsOverlap(output, endpoint.stateDirectory),
            ),
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
    readonly engine: "surge" | "sing-box" | "invalid";
    readonly ok: boolean;
    readonly code?: string;
    readonly paths?: readonly string[];
    readonly diagnostics: readonly Diagnostic[];
  }[];
};
// @concord-code
// @concord-implements docs/feature/artifact-publication/project-config.md
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
      ...(profile.engine === "invalid"
        ? {
            code: profile.code,
            ...(profile.paths ? { paths: profile.paths } : {}),
            diagnostics: [],
          }
        : { diagnostics: profile.compilation.diagnostics }),
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
      if (profile.engine === "invalid") throw new Error();
      const artifacts =
        profile.engine === "surge"
          ? renderSurgeProfiles([profile.compilation], read)
          : render(profile.compilation, read);
      files.set(
        `${entries[index]![0]}.${profile.engine === "surge" ? "conf" : "json"}`,
        artifacts[0]!.content,
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
        exitCode: error.published ? 2 : 1,
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
export type BuildContext = { readonly validation: boolean };
export type BuildDefinition = {
  readonly outDir?: string;
  readonly profiles: Readonly<Record<string, Profile | ProfileDefinition>>;
  readonly preflight?: () => readonly string[];
  readonly secrets?: (token: Secret, context: BuildContext) => string | undefined;
};
export type ProfileBuildResult = BuildResult & {
  readonly warnings: Readonly<Record<string, number>>;
  readonly validation: boolean;
  readonly profileCount: number;
};
function record(
  value: unknown,
  keys?: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    throw new ProfileDefinitionError("INVALID_BUILD_DEFINITION");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (
      typeof key !== "string" ||
      (keys && !keys.includes(key)) ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    )
      throw new ProfileDefinitionError("INVALID_BUILD_DEFINITION");
  }
}
/** Capture data and callback references before application preflight can change its source. */
export function defineBuild(input: BuildDefinition): BuildDefinition {
  try {
    record(input, ["profiles", "preflight", "secrets", "outDir"]);
    if (
      input.outDir !== undefined &&
      (typeof input.outDir !== "string" ||
        !input.outDir.trim() ||
        input.outDir.trim() !== input.outDir ||
        input.outDir.includes("\0"))
    )
      throw new Error();
    record(input.profiles);
    for (const callback of [input.preflight, input.secrets])
      if (callback !== undefined && typeof callback !== "function") throw new Error();
    return Object.freeze({
      ...(input.outDir === undefined ? {} : { outDir: input.outDir }),
      profiles: snapshotProfile(input.profiles as unknown) as Readonly<
        Record<string, Profile | ProfileDefinition>
      >,
      ...(input.preflight === undefined ? {} : { preflight: input.preflight }),
      ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
    });
  } catch {
    throw new ProfileDefinitionError("INVALID_BUILD_DEFINITION");
  }
}
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
  let codes: readonly string[];
  try {
    codes = definition.preflight ? definition.preflight() : [];
  } catch {
    return failure("PREFLIGHT_FAILED");
  }
  try {
    codes = snapshotDefinition(codes);
    if (
      !Array.isArray(codes) ||
      codes.length > 1000 ||
      codes.some((code) => typeof code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code))
    )
      throw new Error();
  } catch {
    return failure("INVALID_PREFLIGHT_WARNINGS");
  }
  const warnings: Record<string, number> = {};
  for (const code of codes) warnings[code] = (warnings[code] ?? 0) + 1;
  const context = Object.freeze({ validation });
  const readSecret = definition.secrets;
  const result = await publish(
    definition.profiles,
    output,
    readSecret ? (token) => readSecret(token, context) : (token) => process.env[token.name],
  );
  return { ...result, warnings, validation, profileCount };
}
