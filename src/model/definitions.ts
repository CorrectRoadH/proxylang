// tsx can load a second SDK instance: classify data descriptors, never messages or getters.
const definitionCodes = new Set([
  "DEFINITION_CYCLE",
  "DEFINITION_DEPTH_EXCEEDED",
  "DEFINITION_EDGE_BUDGET_EXCEEDED",
  "DEFINITION_NOT_DATA",
  "DEFINITION_OBJECT_BUDGET_EXCEEDED",
  "DEFINITION_OUTPUT_BUDGET_EXCEEDED",
  "DEFINITION_UNKNOWN_FIELD",
  "DNS_HOSTS_CONFLICT",
  "DNS_RULE_CONFLICT",
  "DUPLICATE_RESOURCE_ID",
  "GROUP_NAME_CONFLICT",
  "INVALID_BUILD_DEFINITION",
  "INVALID_DESTINATION",
  "INVALID_DNS_RULE",
  "INVALID_DNS_RULES",
  "INVALID_GROUP_DEFINITION",
  "INVALID_MATCH_OPTIONS",
  "INVALID_NATIVE_RULESET",
  "INVALID_PROFILE_DEFINITION",
  "INVALID_RESOURCE_DEFINITION",
  "INVALID_ROUTE_DEFINITION",
  "INVALID_SECRETS_DEFINITION",
  "INVALID_SURGE_GENERAL",
  "INVALID_SURGE_HOSTS",
  "LOGICAL_DEPTH_EXCEEDED",
  "PROFILE_CONDITION_UNSUPPORTED",
  "PROFILE_DESTINATION_UNSUPPORTED",
  "PROFILE_ENDPOINT_UNSUPPORTED",
  "PROFILE_EXTENSION_UNSUPPORTED",
  "PROFILE_GROUP_MEMBER_UNSUPPORTED",
  "PROFILE_GROUP_OPTIONS_UNSUPPORTED",
  "PROFILE_TARGET_UNSUPPORTED",
  "RULESET_COMPOSITION_UNSUPPORTED",
  "UNKNOWN_DESTINATION_ID",
  "UNREGISTERED_DESTINATION_INSTANCE",
  "UNSUPPORTED_GROUP_ALGORITHM",
]);
function validDiagnosticPath(path: unknown): path is string {
  return typeof path === "string" && /^(dns|surge\.hosts)\[\d{1,4}\]$/.test(path);
}
export function definitionDiagnostic(
  error: unknown,
): { readonly code: string; readonly paths?: readonly string[] } | undefined {
  try {
    if (!error || typeof error !== "object") return;
    const name: unknown = Object.getOwnPropertyDescriptor(error, "name")?.value;
    const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value;
    if (name !== "ProfileDefinitionError" || typeof code !== "string" || !definitionCodes.has(code))
      return;
    const paths: unknown = Object.getOwnPropertyDescriptor(error, "paths")?.value;
    // Copy only two own data fields; do not iterate arbitrary arrays or invoke getters.
    if (
      code === "DNS_HOSTS_CONFLICT" &&
      Array.isArray(paths) &&
      Object.getOwnPropertyDescriptor(paths, "length")?.value === 2
    ) {
      const first: unknown = Object.getOwnPropertyDescriptor(paths, "0")?.value;
      const second: unknown = Object.getOwnPropertyDescriptor(paths, "1")?.value;
      if (validDiagnosticPath(first) && validDiagnosticPath(second))
        return { code, paths: [first, second] };
    }
    return { code };
  } catch {
    return;
  }
}
export class ProfileDefinitionError extends Error {
  readonly paths?: readonly string[];
  constructor(
    readonly code: string,
    paths?: readonly string[],
  ) {
    super(code);
    this.name = "ProfileDefinitionError";
    if (paths?.length === 2 && paths.every(validDiagnosticPath))
      this.paths = Object.freeze([...paths]);
  }
}
const fail = (code: string): never => {
  throw new ProfileDefinitionError(code);
};

/** Inspect descriptors before any caller spreads or reads input fields. Shared DAGs are legal. */
export function inspectDefinition(root: unknown): void {
  let edges = 0;
  let objects = 0;
  const visiting = new Set<object>();
  const heights = new Map<object, number>();
  function visit(value: unknown, depth: number): number {
    if (depth > 64) fail("DEFINITION_DEPTH_EXCEEDED");
    if (value === null || typeof value !== "object") {
      if (!["undefined", "string", "number", "boolean"].includes(typeof value) && value !== null)
        fail("DEFINITION_NOT_DATA");
      return 0;
    }
    if (visiting.has(value)) fail("DEFINITION_CYCLE");
    const cached = heights.get(value);
    if (cached !== undefined) {
      if (depth + cached > 64) fail("DEFINITION_DEPTH_EXCEEDED");
      return cached;
    }
    if (++objects > 20000) fail("DEFINITION_OBJECT_BUDGET_EXCEEDED");
    const proto = Object.getPrototypeOf(value);
    if (
      proto !== Object.prototype &&
      proto !== null &&
      !(Array.isArray(value) && proto === Array.prototype)
    )
      fail("DEFINITION_NOT_DATA");
    if (Array.isArray(value) && value.length > 100000) fail("DEFINITION_EDGE_BUDGET_EXCEEDED");
    visiting.add(value);
    let height = 0;
    for (const key of Reflect.ownKeys(value)) {
      if (++edges > 100000) fail("DEFINITION_EDGE_BUDGET_EXCEEDED");
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (
        typeof key !== "string" ||
        !("value" in descriptor) ||
        (!descriptor.enumerable && !(Array.isArray(value) && key === "length"))
      )
        fail("DEFINITION_NOT_DATA");
      height = Math.max(height, 1 + visit(descriptor.value, depth + 1));
    }
    visiting.delete(value);
    heights.set(value, height);
    return height;
  }
  visit(root, 0);
}

/** Count output occurrences, not identities, before allocating each copied value. */
function snapshot<T>(input: T): T {
  let remaining = 100000;
  function copy(value: unknown, depth: number): unknown {
    if (--remaining < 0) fail("DEFINITION_OUTPUT_BUDGET_EXCEEDED");
    if (depth > 64) fail("DEFINITION_DEPTH_EXCEEDED");
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      for (const item of value) output.push(copy(item, depth + 1));
      return output;
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value))
      Object.defineProperty(output, key, {
        value: copy(item, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return output;
  }
  return copy(input, 0) as T;
}
export function snapshotDefinition<T>(input: T): T {
  inspectDefinition(input);
  return snapshot(input);
}
export function exactDefinition(value: object, keys: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("DEFINITION_NOT_DATA");
  if (Object.keys(value).some((key) => !keys.includes(key))) fail("DEFINITION_UNKNOWN_FIELD");
}
