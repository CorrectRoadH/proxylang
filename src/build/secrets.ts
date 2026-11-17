// @concord-file
// @concord-implements docs/feature/profile/library/README.md#秘密
import { RenderError } from "../model/errors.js";
import { sourceFor } from "../model/secret-store.js";
import type { Secret } from "../model/types.js";
import type { Secrets, SecretRef } from "../model/profile-types.js";
const failures = new WeakMap<object, { secretName: string }>();
export function secretFailure(error: unknown): { secretName?: string } {
  return error && typeof error === "object" ? (failures.get(error) ?? {}) : {};
}
export function secretReader(
  secrets: Secrets | undefined,
  validation: boolean,
): (ref: Secret) => string {
  const values = new Map<Secret, string>();
  return (token) => {
    if (values.has(token)) return values.get(token)!;
    const source = sourceFor(secrets, token as SecretRef);
    let code: string | undefined;
    let value: string | undefined;
    if (!source) code = "SECRET_UNDECLARED";
    else if (validation) {
      if (source.validation === undefined) code = "SECRET_VALIDATION_MISSING";
      else value = source.validation;
    } else value = source.value ?? (source.env === undefined ? undefined : process.env[source.env]);
    if (!code && (typeof value !== "string" || !value.length)) code = "SECRET_MISSING";
    if (code) {
      const error = new RenderError(code);
      failures.set(error, { secretName: token.name });
      throw error;
    }
    values.set(token, value!);
    return value!;
  };
}
