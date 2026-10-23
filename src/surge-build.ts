// @concord-file
// @concord-implements docs/feature/artifact-publication/use-case/publish-generation.md
import { deepFreeze } from "./schema.js";
import { ProfileDefinitionError, snapshotDefinition } from "./surge-definitions.js";
import { buildSurgeProfilesToDirectory } from "./surge-host.js";
import type { SurgeProfileInput } from "./surge-profile.js";
import type { BuildResult } from "./host.js";
import type { Secret } from "./types.js";

export type SurgeBuildContext = { readonly validation: boolean };
export type SurgeBuildDefinition = {
  readonly profiles: Readonly<Record<string, SurgeProfileInput>>;
  readonly preflight?: () => readonly string[];
  readonly resolveSecret?: (token: Secret, context: SurgeBuildContext) => string | undefined;
};
export type SurgeBuildResult = BuildResult & {
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
export function defineSurgeBuild(input: SurgeBuildDefinition): SurgeBuildDefinition {
  try {
    record(input, ["profiles", "preflight", "resolveSecret"]);
    record(input.profiles);
    for (const callback of [input.preflight, input.resolveSecret])
      if (callback !== undefined && typeof callback !== "function") throw new Error();
    return Object.freeze({
      profiles: deepFreeze(snapshotDefinition(input.profiles)),
      ...(input.preflight === undefined ? {} : { preflight: input.preflight }),
      ...(input.resolveSecret === undefined ? {} : { resolveSecret: input.resolveSecret }),
    });
  } catch {
    throw new ProfileDefinitionError("INVALID_BUILD_DEFINITION");
  }
}
export function surgeBuildFailure(
  code: string,
  validation = false,
  profileCount = 0,
): SurgeBuildResult {
  return { published: false, exitCode: 1, code, warnings: {}, validation, profileCount };
}
/** Pure orchestration result; the CLI owns stdout and process exit status. */
export async function runSurgeBuild(
  input: SurgeBuildDefinition,
  output: string,
  options: { readonly validation?: boolean } = {},
): Promise<SurgeBuildResult> {
  let validation: boolean;
  try {
    record(options, ["validation"]);
    if (options.validation !== undefined && typeof options.validation !== "boolean")
      throw new Error();
    validation = options.validation ?? false;
  } catch {
    return surgeBuildFailure("INVALID_BUILD_OPTIONS");
  }
  let definition: SurgeBuildDefinition;
  try {
    definition = defineSurgeBuild(input);
  } catch {
    return surgeBuildFailure("INVALID_BUILD_DEFINITION", validation);
  }
  const profileCount = Object.keys(definition.profiles).length;
  const failure = (code: string) => surgeBuildFailure(code, validation, profileCount);
  if (typeof output !== "string" || !output.trim()) return failure("INVALID_OUTPUT_DIRECTORY");
  if (validation && !definition.resolveSecret) return failure("VALIDATION_RESOLVER_REQUIRED");
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
  const resolver = definition.resolveSecret;
  const result = await buildSurgeProfilesToDirectory(
    definition.profiles,
    output,
    resolver ? (token) => resolver(token, context) : (token) => process.env[token.name],
  );
  return { ...result, warnings, validation, profileCount };
}
