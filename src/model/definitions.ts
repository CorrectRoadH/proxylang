import { kindOf, captureOrigin, type Origin } from "./identity.js";
// tsx can load a second SDK instance: classify data descriptors, never messages or getters.
function validDiagnosticPath(path: unknown): path is string {
  return (
    typeof path === "string" && path.length <= 512 && /^[a-zA-Z][a-zA-Z0-9_.[\]-]*$/.test(path)
  );
}
export function definitionDiagnostic(
  error: unknown,
):
  | { readonly code: string; readonly paths?: readonly string[]; readonly origin?: Origin }
  | undefined {
  try {
    if (!error || typeof error !== "object") return;
    const own = (key: string): unknown => Object.getOwnPropertyDescriptor(error, key)?.value;
    const code = own("code");
    if (
      own("name") !== "ProfileDefinitionError" ||
      typeof code !== "string" ||
      ![
        "INVALID_RESOURCE",
        "INVALID_FIELD",
        "UNKNOWN_FIELD",
        "EMPTY_FRAGMENT",
        "INVALID_PROFILE_DEFINITION",
        "INVALID_BUILD_DEFINITION",
        "PROFILE_EXTENSION_UNSUPPORTED",
        "DNS_HOSTS_CONFLICT",
        "DNS_RULE_CONFLICT",
      ].includes(code)
    )
      return;
    const output: { code: string; paths?: string[]; origin?: Origin } = { code };
    const paths = own("paths");
    if (Array.isArray(paths) && paths.length <= 16) {
      const values = Array.from(
        { length: paths.length },
        (_, i) => Object.getOwnPropertyDescriptor(paths, String(i))?.value as unknown,
      );
      if (values.every(validDiagnosticPath)) output.paths = values;
    }
    const origin = own("origin");
    if (origin && typeof origin === "object") {
      const field = (key: string): unknown => Object.getOwnPropertyDescriptor(origin, key)?.value;
      const file = field("file"),
        line = field("line"),
        column = field("column");
      if (
        typeof file === "string" &&
        file.length <= 4096 &&
        !/[\p{C}]/u.test(file) &&
        Number.isInteger(line) &&
        Number.isInteger(column) &&
        (line as number) > 0 &&
        (column as number) > 0
      )
        output.origin = { file, line: line as number, column: column as number };
    }
    return output;
  } catch {
    return;
  }
}
export class ProfileDefinitionError extends Error {
  readonly paths?: readonly string[];
  readonly origin?: Origin;
  constructor(
    readonly code: string,
    paths?: readonly string[],
  ) {
    const normalized =
      code === "DEFINITION_UNKNOWN_FIELD"
        ? "UNKNOWN_FIELD"
        : code.startsWith("DEFINITION_")
          ? "INVALID_PROFILE_DEFINITION"
          : code.startsWith("INVALID_") &&
              ![
                "INVALID_BUILD_DEFINITION",
                "INVALID_PROFILE_DEFINITION",
                "INVALID_RESOURCE",
              ].includes(code)
            ? "INVALID_FIELD"
            : code;
    super(normalized);
    this.code = normalized;
    this.origin = captureOrigin();
    this.name = "ProfileDefinitionError";
    if (paths?.length && paths.every((p) => typeof p === "string"))
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
    if (kindOf(value)) return value;
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
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) throw new ProfileDefinitionError("UNKNOWN_FIELD", unknown);
}
