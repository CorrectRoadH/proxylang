#!/usr/bin/env node
// @concord-file
// @concord-implements docs/feature/artifact-publication/README.md
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
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
  if (!command || command === "--help") {
    print({
      usage: [
        "proxylang targets",
        "proxylang check config.ts",
        "proxylang explain config.ts --target ID --request JSON",
        "proxylang build config.ts --out DIRECTORY",
      ],
      trustedConfig: true,
    });
    return 0;
  }
  if (!["check", "explain", "build"].includes(command) || !file)
    return failure("INVALID_ARGUMENTS");
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]!;
    const value = rest[i + 1];
    if (!key.startsWith("--") || value === undefined || options.has(key))
      return failure("INVALID_ARGUMENTS");
    options.set(key, value);
  }
  const allowed =
    command === "check" ? [] : command === "build" ? ["--out"] : ["--target", "--request"];
  if (
    [...options.keys()].some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !options.has(key))
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
    let request: unknown;
    try {
      request = JSON.parse(options.get("--request")!);
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
