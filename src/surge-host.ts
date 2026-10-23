// @concord-file
// @concord-implements docs/feature/artifact-publication/use-case/publish-generation.md
import { join, resolve } from "node:path";
import type { BuildResult } from "./host.js";
import type { Secret } from "./types.js";
import { RenderError } from "./proxies.js";
import {
  compileSurgeProfile,
  renderSurgeProfiles,
  type SurgeProfileInput,
} from "./surge-profile.js";
import { publishProfiles, SurgePublishError } from "./surge-publish.js";

/** Complete-profile batches use the out symlink protocol; the Program host remains unchanged. */
export async function buildSurgeProfilesToDirectory(
  profiles: Readonly<Record<string, SurgeProfileInput>>,
  output: string,
  resolveSecret: (token: Secret) => string | undefined = (token) => process.env[token.name],
): Promise<BuildResult> {
  if (typeof output !== "string" || !output.trim())
    return { published: false, exitCode: 1, code: "INVALID_OUTPUT_DIRECTORY" };
  try {
    const entries = Object.entries(profiles);
    if (
      !entries.length ||
      entries.length > 16 ||
      entries.some(([id]) => !/^[a-z0-9][a-z0-9-]*$/.test(id))
    )
      return { published: false, exitCode: 1, code: "INVALID_PROFILE_FILENAMES" };
    const compiled = entries.map(([, input]) => compileSurgeProfile(input));
    if (compiled.some((profile) => !profile.ok))
      return { published: false, exitCode: 1, code: "COMPILATION_FAILED" };
    const artifacts = renderSurgeProfiles(compiled, resolveSecret);
    await publishProfiles(
      new Map(entries.map(([id], i) => [`${id}.conf`, artifacts[i]!.content])),
      output,
    );
    return {
      published: true,
      exitCode: 0,
      code: "PUBLISHED",
      active: join(resolve(output), "out"),
    };
  } catch (error) {
    if (error instanceof SurgePublishError) {
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
    }
    return {
      published: false,
      exitCode: 1,
      code: error instanceof RenderError ? error.code : "BUILD_FAILED",
    };
  }
}
