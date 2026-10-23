// @concord-file
// @concord-implements docs/feature/artifact-publication/use-case/publish-generation.md
import { join, resolve } from "node:path";
import {
  captureBuild,
  executeBuild,
  type BuildDefinition as Definition,
  type ProfileBuildResult,
} from "./build-core.js";
import { compileProfile, snapshotProfile, type Profile } from "./profile.js";
import { pathsOverlap, RenderError } from "./proxies.js";
import { secretReader } from "./secrets.js";
import { render } from "./render.js";
import { renderSurgeProfiles } from "./surge-profile.js";
import { publishProfiles, SurgePublishError } from "./surge-publish.js";
import type { BuildResult } from "./host.js";
import type { Secret } from "./types.js";
export type BuildDefinition = Definition<Profile>;
export type { BuildContext, ProfileBuildResult } from "./build-core.js";
export function defineBuild(input: BuildDefinition): BuildDefinition {
  return captureBuild(input, snapshotProfile);
}
async function publish(
  profiles: Readonly<Record<string, Profile>>,
  output: string,
  resolver: (token: Secret) => string | undefined,
): Promise<BuildResult> {
  try {
    const entries = Object.entries(profiles);
    if (
      !entries.length ||
      entries.length > 16 ||
      entries.some(([id]) => !/^[a-z0-9][a-z0-9-]*$/.test(id))
    )
      return { published: false, exitCode: 1, code: "INVALID_PROFILE_FILENAMES" };
    const compiled = entries.map(([, profile]) => compileProfile(profile));
    const invalid = compiled.find((profile) => !profile.ok);
    if (invalid)
      return {
        published: false,
        exitCode: 1,
        code: invalid.engine === "invalid" ? invalid.code : "COMPILATION_FAILED",
      };
    if (
      compiled.some(
        (profile) =>
          profile.engine === "sing-box" &&
          profile.compilation.plans.some((plan) =>
            plan.program.endpoints?.some((endpoint) =>
              pathsOverlap(resolve(output), endpoint.stateDirectory),
            ),
          ),
      )
    )
      return { published: false, exitCode: 1, code: "ENDPOINT_STATE_OVERLAP" };
    const read = secretReader(resolver);
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
    };
  }
}
export function runBuild(
  input: BuildDefinition,
  output: string,
  options: { readonly validation?: boolean } = {},
): Promise<ProfileBuildResult> {
  return executeBuild(input, output, options, defineBuild, publish);
}
