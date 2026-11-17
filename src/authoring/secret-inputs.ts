// @concord-file
// @concord-implements docs/feature/profile/library/README.md#秘密
import { exactDefinition, ProfileDefinitionError } from "../model/definitions.js";
import { secretSources, type SecretSource } from "../model/secret-store.js";
import { created, inspectRecord } from "./data.js";
import type { Secrets, SecretRef } from "../model/profile-types.js";
type Source = (
  | { readonly env: string; readonly value?: never }
  | { readonly value: string; readonly env?: never }
) & { readonly validation?: string };
export function defineSecrets<const T extends Record<string, Source>>(
  input: T,
): Secrets<Extract<keyof T, string>> {
  inspectRecord(input);
  exactDefinition(input, Object.keys(input));
  const refs: Record<string, SecretRef> = {};
  const sources = new Map<SecretRef, SecretSource>();
  for (const [name, source] of Object.entries(input)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new ProfileDefinitionError("INVALID_FIELD");
    exactDefinition(source, ["env", "value", "validation"]);
    if (
      (source.env === undefined) === (source.value === undefined) ||
      (source.env !== undefined && (typeof source.env !== "string" || !source.env)) ||
      (source.value !== undefined && typeof source.value !== "string") ||
      (source.validation !== undefined && typeof source.validation !== "string")
    )
      throw new ProfileDefinitionError("INVALID_FIELD", [name]);
    const ref = created({ type: "env" as const, name }, "secret");
    Object.defineProperty(refs, name, { value: ref, enumerable: true });
    sources.set(ref, Object.freeze({ ...source }));
  }
  const collection = created(refs, "secrets") as Secrets<Extract<keyof T, string>>;
  secretSources.set(collection, sources);
  return collection;
}
