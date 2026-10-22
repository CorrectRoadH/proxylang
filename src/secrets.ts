// @concord-file
// @concord-implements docs/feature/artifact-publication/README.md
import { RenderError } from "./proxies.js";
import type { Secret } from "./types.js";

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
    } catch {
      throw new RenderError("SECRET_RESOLUTION_FAILED");
    }
    if (typeof value !== "string" || value.length === 0) throw new RenderError("SECRET_MISSING");
    values.set(token.name, value);
    return value;
  };
}
