#!/usr/bin/env node
// @concord-file
// @concord-implements docs/feature/artifact-publication/README.md
import { definitionDiagnostic } from "./surge-definitions.js";
import { runBuild, checkBuild, defineBuild } from "./profile-build.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { open, lstat, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tsImport } from "tsx/esm/api";
import { StaticRuleSetUnknownError } from "./rules.js";
import { compile, explain, targetCatalog } from "./compiler.js";
import { buildToDirectory } from "./host.js";
import { requestSchema } from "./schema.js";

const print = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + "\n");
const failure = (code: string): number => {
  print({ ok: false, code });
  return 1;
};
const usages = {
  targets: ["proxylang targets"],
  check: ["proxylang check"],
  explain: [
    "proxylang explain --target ID --request JSON",
    "proxylang explain --target ID --request-file FILE",
  ],
  build: ["proxylang build [--validation]"],
};
async function readRequestFile(path: string): Promise<string> {
  const limit = 1024 * 1024;
  const file = await open(resolve(path), constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("REQUEST_FILE_READ_FAILED");
    if (stat.size > limit) throw new Error("REQUEST_FILE_TOO_LARGE");
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = await file.read(buffer, size, buffer.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > limit) throw new Error("REQUEST_FILE_TOO_LARGE");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
  } finally {
    await file.close();
  }
}
function loadFailure(cause: unknown): number {
  const diagnostic = definitionDiagnostic(cause);
  if (diagnostic) {
    print({
      ok: false,
      code: "CONFIG_LOAD_FAILED",
      reason: "INVALID_CONFIGURATION",
      diagnostic,
      hint: "检查配置字段与库定义约束",
    });
    return 1;
  }
  let code: unknown;
  let name: unknown;
  try {
    if (cause && typeof cause === "object") {
      code = Object.getOwnPropertyDescriptor(cause, "code")?.value;
      name = Object.getOwnPropertyDescriptor(cause, "name")?.value;
      if (cause instanceof SyntaxError) name = "SyntaxError";
    }
  } catch {
    // Arbitrary configuration exceptions, including proxies, are not trusted diagnostics.
  }
  const detail =
    code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND" || code === "ENOENT"
      ? { reason: "MODULE_NOT_FOUND", hint: "检查配置文件和 import 路径，并安装所需依赖" }
      : code === "EACCES" || code === "EPERM"
        ? { reason: "ACCESS_DENIED", hint: "检查配置及导入文件的读取权限" }
        : name === "TransformError" || name === "SyntaxError"
          ? { reason: "INVALID_SYNTAX", hint: "使用 TypeScript 检查配置与导入文件的语法" }
          : { reason: "EXECUTION_FAILED", hint: "检查默认导出、导入依赖和配置顶层执行逻辑" };
  print({ ok: false, code: "CONFIG_LOAD_FAILED", ...detail });
  return 1;
}
// @concord-code
// @concord-implements docs/feature/artifact-publication/cli.md
async function main(args: string[]): Promise<number> {
  const root = process.cwd();
  const [command, ...rest] = args;
  if (command === "targets" && args.length === 1) {
    print(targetCatalog);
    return 0;
  }
  const help = (value: string | undefined) => value === "--help" || value === "-h";
  if (
    !command ||
    (help(command) && args.length === 1) ||
    (Object.hasOwn(usages, command) && help(rest[0]) && rest.length === 1)
  ) {
    print({
      usage:
        command && Object.hasOwn(usages, command)
          ? usages[command as keyof typeof usages]
          : Object.values(usages).flat(),
      configFile: "proxylang.config.ts",
      trustedConfig: true,
    });
    return 0;
  }
  if (!["check", "explain", "build"].includes(command)) return failure("INVALID_ARGUMENTS");
  const options = new Map<string, string>();
  let validation = false;
  if (command === "build") {
    if (
      (rest.length === 1 && rest[0] === "--validation") ||
      (rest.length === 2 && rest[0] === "--" && rest[1] === "--validation")
    )
      validation = true;
    else if (rest.length) return failure("INVALID_ARGUMENTS");
  } else if (command === "check") {
    if (rest.length) return failure("INVALID_ARGUMENTS");
  } else {
    for (let i = 0; i < rest.length; i += 2) {
      const key = rest[i]!;
      const value = rest[i + 1];
      if (
        !["--target", "--request", "--request-file"].includes(key) ||
        !value?.trim() ||
        value.startsWith("--") ||
        options.has(key)
      )
        return failure("INVALID_ARGUMENTS");
      options.set(key, value);
    }
    if (!options.has("--target") || options.has("--request") === options.has("--request-file"))
      return failure("INVALID_ARGUMENTS");
  }
  const file = resolve(root, "proxylang.config.ts");
  let found = false;
  try {
    const info = await lstat(file);
    found = true;
    if (!(info.isSymbolicLink() ? (await stat(file)).isFile() : info.isFile()))
      return loadFailure({ code: "INVALID_CONFIG_FILE" });
  } catch (cause) {
    if (
      !found &&
      cause &&
      typeof cause === "object" &&
      Object.getOwnPropertyDescriptor(cause, "code")?.value === "ENOENT"
    )
      return failure("CONFIG_NOT_FOUND");
    return loadFailure(cause);
  }
  let config: unknown;
  try {
    const loaded = await tsImport(pathToFileURL(resolve(file)).href, import.meta.url);
    // tsx follows the config's package scope: TS outside type:module uses CJS interop.
    config = loaded.default?.__esModule === true ? loaded.default.default : loaded.default;
  } catch (cause) {
    return loadFailure(cause);
  }
  const profileDescriptor =
    config && typeof config === "object"
      ? Object.getOwnPropertyDescriptor(config, "profiles")
      : undefined;
  if (profileDescriptor) {
    let definition;
    try {
      definition = defineBuild(config as Parameters<typeof defineBuild>[0]);
      if (definition.outDir !== undefined)
        definition = { ...definition, outDir: resolve(root, definition.outDir) };
    } catch {
      return failure("INVALID_BUILD_DEFINITION");
    }
    if (command !== "build") {
      const checked = checkBuild(definition);
      if (!checked.ok || command === "check") {
        print(checked);
        return checked.ok ? 0 : 1;
      }
      return failure("EXPLAIN_PROFILE_UNSUPPORTED");
    }
    if (definition.outDir === undefined) return failure("OUTPUT_DIRECTORY_REQUIRED");
    const built = await runBuild(definition, definition.outDir, { validation });
    print(built);
    return built.exitCode;
  }
  if (validation) return failure("VALIDATION_PROFILE_REQUIRED");
  const result = compile(config);
  if (!result.ok) {
    print({ ok: false, diagnostics: result.diagnostics, cases: result.cases });
    return 1;
  }
  if (command === "check") {
    print({
      ok: true,
      diagnostics: result.diagnostics,
      cases: result.cases,
      targets: result.plans.map((plan) => ({
        target: plan.target,
        rules: plan.rules.length,
        sourceMap: plan.sourceMap,
        strategySelections: plan.strategySelections,
        preconditions: plan.preconditions,
        nativeValidation: plan.nativeValidation,
      })),
    });
    return 0;
  }
  if (command === "explain") {
    let source = options.get("--request");
    if (options.has("--request-file")) {
      try {
        source = await readRequestFile(resolve(root, options.get("--request-file")!));
      } catch (cause) {
        return failure(
          cause instanceof Error && cause.message === "REQUEST_FILE_TOO_LARGE"
            ? "REQUEST_FILE_TOO_LARGE"
            : "REQUEST_FILE_READ_FAILED",
        );
      }
    }
    let request: unknown;
    try {
      request = JSON.parse(source!);
    } catch {
      return failure("INVALID_REQUEST");
    }
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success) return failure("INVALID_REQUEST");
    if (!result.plans.some((plan) => plan.target.id === options.get("--target")))
      return failure("UNKNOWN_TARGET");
    print({
      ...explain(result, options.get("--target")!, parsed.data),
      diagnostics: result.diagnostics,
    });
    return 0;
  }
  const outDir = Object.getOwnPropertyDescriptor(config, "outDir")?.value as string | undefined;
  if (outDir === undefined) return failure("OUTPUT_DIRECTORY_REQUIRED");
  const built = await buildToDirectory(result, resolve(root, outDir));
  print({ ...built, diagnostics: result.diagnostics });
  return built.exitCode;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (cause) {
  process.exitCode = failure(
    cause instanceof StaticRuleSetUnknownError ? cause.message : "UNEXPECTED_FAILURE",
  );
}
