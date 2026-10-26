// @concord-file
// @concord-implements docs/feature/artifact-publication/README.md
import { RenderError } from "./proxies.js";
import type { Secret } from "./types.js";

export type SecretFailure = {
  readonly secretName?: string;
  readonly secretReason?: "MISSING" | "RESOLUTION_FAILED";
};
const failures = new WeakMap<object, SecretFailure>();
export function secretFailure(error: unknown): SecretFailure {
  return error !== null && typeof error === "object" ? (failures.get(error) ?? {}) : {};
}
function failure(code: string, name: string, reason: "MISSING" | "RESOLUTION_FAILED") {
  const error = new RenderError(code);
  if (/^[A-Z][A-Z0-9_]{0,127}$/.test(name))
    failures.set(error, Object.freeze({ secretName: name, secretReason: reason }));
  return error;
}
/** One reader per rendering batch; exceptions and missing values never disclose credentials. */
export function secretReader(
  resolveSecret: (token: Secret) => string | undefined,
): (token: Secret) => string {
  const values = new Map<string, string>();
  return (token) => {
    if (values.has(token.name)) return values.get(token.name)!;
    let value: string | undefined;
    try {
      value = resolveSecret(token);
    } catch (error) {
      const nested = secretFailure(error);
      throw failure(
        "SECRET_RESOLUTION_FAILED",
        token.name,
        nested.secretName === token.name && nested.secretReason === "MISSING"
          ? "MISSING"
          : "RESOLUTION_FAILED",
      );
    }
    if (typeof value !== "string" || value.length === 0)
      throw failure("SECRET_MISSING", token.name, "MISSING");
    values.set(token.name, value);
    return value;
  };
}
