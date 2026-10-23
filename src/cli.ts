#!/usr/bin/env node
// @concord-file
// @concord-implements docs/feature/artifact-publication/README.md
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { open } from "node:fs/promises";
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
  check: ["proxylang check config.ts"],
  explain: [
    "proxylang explain config.ts --target ID --request JSON",
    "proxylang explain config.ts --target ID --request-file FILE",
  ],
  build: ["proxylang build config.ts --out DIRECTORY"],
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
  const [command, file, ...rest] = args;
  if (command === "targets" && args.length === 1) {
    print(targetCatalog);
    return 0;
  }
  const help = (value: string | undefined) => value === "--help" || value === "-h";
  if (
    !command ||
    (help(command) && args.length === 1) ||
    (Object.hasOwn(usages, command) && help(file) && args.length === 2)
  ) {
    print({
      usage:
        command && Object.hasOwn(usages, command)
          ? usages[command as keyof typeof usages]
          : Object.values(usages).flat(),
      trustedConfig: true,
    });
    return 0;
  }
  if (!["check", "explain", "build"].includes(command) || !file?.trim() || help(file))
    return failure("INVALID_ARGUMENTS");
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]!;
    const value = rest[i + 1];
    if (!key.startsWith("--") || !value?.trim() || options.has(key))
      return failure("INVALID_ARGUMENTS");
    options.set(key, value);
  }
  const allowed =
    command === "check"
      ? []
      : command === "build"
        ? ["--out"]
        : ["--target", "--request", "--request-file"];
  const required = command === "check" ? [] : command === "build" ? ["--out"] : ["--target"];
  if (
    [...options.keys()].some((key) => !allowed.includes(key)) ||
    required.some((key) => !options.has(key)) ||
    (command === "explain" && options.has("--request") === options.has("--request-file"))
  )
    return failure("INVALID_ARGUMENTS");
  let config: unknown;
  try {
    const loaded = await tsImport(pathToFileURL(resolve(file)).href, import.meta.url);
    // tsx follows the config's package scope: TS outside type:module uses CJS interop.
    config = loaded.default?.__esModule === true ? loaded.default.default : loaded.default;
  } catch (cause) {
    return loadFailure(cause);
  }
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
        source = await readRequestFile(options.get("--request-file")!);
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
  const built = await buildToDirectory(result, options.get("--out")!);
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
