// @concord-file
// @concord-implements docs/feature/artifact-publication/use-case/publish-generation.md
import {
  captureBuild,
  executeBuild,
  profileBuildFailure,
  type BuildContext,
  type BuildDefinition,
  type ProfileBuildResult,
} from "./build-core.js";
import { snapshotDefinition } from "./surge-definitions.js";
import { buildSurgeProfilesToDirectory } from "./surge-host.js";
import type { SurgeProfileInput } from "./surge-profile.js";
export type SurgeBuildContext = BuildContext;
export type SurgeBuildDefinition = BuildDefinition<SurgeProfileInput>;
export type SurgeBuildResult = ProfileBuildResult;
export const surgeBuildFailure = profileBuildFailure;
export function defineSurgeBuild(input: SurgeBuildDefinition): SurgeBuildDefinition {
  return captureBuild(input, snapshotDefinition);
}
export function runSurgeBuild(
  input: SurgeBuildDefinition,
  output: string,
  options: { readonly validation?: boolean } = {},
): Promise<SurgeBuildResult> {
  return executeBuild(input, output, options, defineSurgeBuild, buildSurgeProfilesToDirectory);
}
