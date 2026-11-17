import { ProfileDefinitionError } from "../model/definitions.js";
import { snapshotProfile } from "./profile.js";
import type { Profile, ProfileDefinition } from "../model/profile-types.js";
import type { BuildDefinition } from "../model/build-types.js";
export function record(
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
/** Capture the immutable batch before any secret source is invoked. */
export function defineBuild(input: BuildDefinition): BuildDefinition {
  try {
    record(input, ["profiles", "secrets", "outDir"]);
    if (
      input.outDir !== undefined &&
      (typeof input.outDir !== "string" ||
        !input.outDir.trim() ||
        input.outDir.trim() !== input.outDir ||
        input.outDir.includes("\0"))
    )
      throw new Error();
    record(input.profiles);
    for (const callback of [input.secrets])
      if (callback !== undefined && typeof callback !== "function") throw new Error();
    return Object.freeze({
      ...(input.outDir === undefined ? {} : { outDir: input.outDir }),
      profiles: snapshotProfile(input.profiles as unknown) as Readonly<
        Record<string, Profile | ProfileDefinition>
      >,
      ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
    });
  } catch {
    throw new ProfileDefinitionError("INVALID_BUILD_DEFINITION");
  }
}
