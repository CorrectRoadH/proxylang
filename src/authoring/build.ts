import { ProfileDefinitionError } from "../model/definitions.js";
import { created, requireKind } from "./data.js";
import { kindOf } from "../model/identity.js";
import type { SDK } from "../model/identity.js";
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
export function defineBuild(input: Omit<BuildDefinition, keyof SDK<"build">>): BuildDefinition {
  if (kindOf(input) === "build") return input as BuildDefinition;
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
    const keys = Object.keys(input.profiles);
    if (!keys.length || keys.length > 16 || keys.some((k) => !/^[a-z0-9][a-z0-9-]*$/.test(k)))
      throw new Error();
    for (const p of Object.values(input.profiles)) requireKind(p, ["profile"]);
    if (input.secrets !== undefined) requireKind(input.secrets, ["secrets"]);
    return created(
      {
        ...(input.outDir === undefined ? {} : { outDir: input.outDir }),
        profiles: input.profiles,
        ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
      },
      "build",
    );
  } catch {
    throw new ProfileDefinitionError("INVALID_BUILD_DEFINITION");
  }
}
