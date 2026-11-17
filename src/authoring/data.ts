// @concord-file
// @concord-implements docs/feature/profile/library/README.md#输入快照与预算
import {
  inspectDefinition,
  snapshotDefinition,
  ProfileDefinitionError,
} from "../model/definitions.js";
import { deepFreeze } from "../model/schema.js";
import { kindOf, register, type Kind, type SDK } from "../model/identity.js";
import type { Fragments } from "../model/profile-types.js";
import type { z } from "zod";
export function frozen<T>(value: T): T {
  return deepFreeze(snapshotDefinition(value));
}
export function created<T extends object, K extends Kind>(value: T, kind: K): T & SDK<K> {
  return register(frozen(value), kind);
}
export function requireKind(value: unknown, kinds: readonly Kind[]): void {
  if (!kinds.includes(kindOf(value)!)) throw new ProfileDefinitionError("INVALID_RESOURCE");
}
export function flatten<T>(input: Fragments<T>): T[] {
  inspectDefinition(input);
  let budget = 100000;
  const output: T[] = [];
  const visit = (v: Fragments<T>): void => {
    if (--budget < 0) throw new ProfileDefinitionError("INVALID_PROFILE_DEFINITION");
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
    } else output.push(v as T);
  };
  visit(input);
  return output;
}
export function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  inspectDefinition(value);
  const result = schema.safeParse(value);
  if (!result.success) {
    const unknown = result.error.issues.filter((i) => i.code === "unrecognized_keys");
    throw new ProfileDefinitionError(
      unknown.length ? "UNKNOWN_FIELD" : "INVALID_FIELD",
      result.error.issues.flatMap((i) =>
        i.code === "unrecognized_keys"
          ? i.keys.map((k) => [...i.path, k].join("."))
          : [i.path.join(".")],
      ),
    );
  }
  return result.data;
}

export function inspectRecord(value: unknown): asserts value is Record<string, unknown> {
  inspectDefinition(value);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProfileDefinitionError("INVALID_FIELD");
}
