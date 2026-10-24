// @concord-file
// @concord-implements docs/feature/artifact-publication/secret-inputs.md
import type { Secret } from "./types.js";
import type { BuildContext } from "./profile-build.js";
import { exactDefinition, inspectDefinition, ProfileDefinitionError } from "./surge-definitions.js";
import { RenderError } from "./proxies.js";

export type SecretsInput = {
  readonly values?: Readonly<Record<string, string>>;
  readonly env?: readonly string[];
  readonly validation?: Readonly<Record<string, string>>;
};

/** Capture declarations now; read only referenced, allowed environment names at render time. */
export function secrets(
  input: SecretsInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): (token: Secret, context?: BuildContext) => string | undefined {
  let values: Map<string, string>;
  let validation: Map<string, string>;
  let env: Set<string>;
  try {
    inspectDefinition(input);
    exactDefinition(input, ["values", "env", "validation"]);
    if (!environment || typeof environment !== "object") throw new Error();
    let total = 0;
    const name = /^[A-Z][A-Z0-9_]{0,127}$/;
    const entries = (record: Readonly<Record<string, string>> | undefined) => {
      if (record === undefined) return [];
      exactDefinition(record, Object.keys(record));
      const fields = Object.entries(record);
      if (fields.length > 2000) throw new Error();
      for (const [key, value] of fields) {
        if (!name.test(key) || typeof value !== "string" || !value.length || value.length > 65536)
          throw new Error();
        total += value.length;
        if (total > 1048576) throw new Error();
      }
      return fields;
    };
    const fixed = entries(input.values);
    const substitutes = entries(input.validation);
    const allowed = input.env === undefined ? [] : input.env;
    if (
      !Array.isArray(allowed) ||
      allowed.length > 2000 ||
      Array.from(allowed).some((key) => typeof key !== "string" || !name.test(key))
    )
      throw new Error();
    values = new Map(fixed);
    validation = new Map(substitutes);
    env = new Set(allowed);
    if (
      env.size !== allowed.length ||
      [...env].some((key) => values.has(key)) ||
      [...validation.keys()].some((key) => !values.has(key) && !env.has(key))
    )
      throw new Error();
  } catch {
    throw new ProfileDefinitionError("INVALID_SECRETS_DEFINITION");
  }
  return (token, context = { validation: false }) => {
    if (context.validation && validation.has(token.name)) return validation.get(token.name);
    if (values.has(token.name)) return values.get(token.name);
    if (!env.has(token.name)) return undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(environment, token.name);
      if (!descriptor) return undefined;
      if (
        !("value" in descriptor) ||
        (descriptor.value !== undefined && typeof descriptor.value !== "string")
      )
        throw new Error();
      return descriptor.value as string | undefined;
    } catch {
      throw new RenderError("SECRET_RESOLUTION_FAILED");
    }
  };
}
