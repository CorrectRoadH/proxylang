#!/usr/bin/env node
// @concord-file
// @concord-implements docs/feature/build/cli.md
import { definitionDiagnostic, targetCatalog } from "./build/index.js";
import type { CheckResult } from "./build/index.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { lstat, stat } from "node:fs/promises";
import { register } from "tsx/esm/api";
import { register as registerCjs } from "tsx/cjs/api";
let json = false;
function print(value: unknown, text?: string) {
  process.stdout.write(
    json ? JSON.stringify(value, null, 2) + "\n" : (text ?? human(value)) + "\n",
  );
}
function human(value: unknown): string {
  if (!value || typeof value !== "object") return String(value);
  if ("profiles" in value) return humanCheck(value as CheckResult);
  if ("check" in value) {
    const result = value as {
      check: CheckResult;
      code: string;
      secretName?: string;
      hint?: string;
    };
    return `${humanCheck(result.check)}\n${result.code}${result.secretName ? " " + result.secretName : ""}${result.hint ? "\n" + result.hint : ""}`;
  }
  if ("targets" in value)
    return (
      value as {
        targets: {
          engine: string;
          platform: string;
          version: string;
          modes: string[];
          artifact: string;
        }[];
      }
    ).targets
      .map((t) => `${t.engine} ${t.platform} ${t.version}  ${t.modes.join("/")}  ${t.artifact}`)
      .join("\n");
  const r = value as {
    code?: string;
    reason?: string;
    hint?: string;
    paths?: string[];
    origin?: { file: string; line: number; column: number };
  };
  return [
    r.code,
    r.reason,
    r.hint,
    r.paths?.join(", "),
    r.origin ? `${r.origin.file}:${r.origin.line}:${r.origin.column}` : undefined,
  ]
    .filter(Boolean)
    .join("  ");
}
function humanCheck(check: CheckResult): string {
  return (
    check.profiles
      .map(
        (p) =>
          `${p.ok ? "✓" : "✗"} ${p.key}  ${p.target.engine} ${p.target.platform} ${p.target.version}${p.selections
            .flatMap((s) =>
              s.kind === "algorithm"
                ? [`  auto: ${s.group}→${s.algorithm}`]
                : s.kind === "ruleSet"
                  ? [`  ruleSets: ${s.ruleSet}→${s.branch} (${s.nativeName})`]
                  : [],
            )
            .join(
              "",
            )}\n${p.diagnostics.map((d) => `  ${d.severity} ${d.code}  ${d.path}${d.origin ? `  ${d.origin.file}:${d.origin.line}:${d.origin.column}` : ""}`).join("\n")}`,
      )
      .join("\n") + `\n${check.code}`
  );
}
function failure(code: string, detail: object = {}): number {
  print({ ok: false, code, ...detail });
  return 1;
}
const usage = [
  "proxylang check [--json]",
  "proxylang build [--validation] [--json]",
  "proxylang explain --profile KEY (--request JSON | --request-file FILE) [--json]",
  "proxylang targets [--json]",
];
function loadFailure(cause: unknown): number {
  const diagnostic = definitionDiagnostic(cause);
  if (diagnostic)
    return failure("CONFIG_LOAD_FAILED", {
      reason: "INVALID_CONFIGURATION",
      ...diagnostic,
      code: "CONFIG_LOAD_FAILED",
      hint: diagnostic.code,
    });
  let code: unknown, name: unknown;
  try {
    if (cause && typeof cause === "object") {
      code = Object.getOwnPropertyDescriptor(cause, "code")?.value;
      name = Object.getOwnPropertyDescriptor(cause, "name")?.value;
    }
  } catch {}
  return failure("CONFIG_LOAD_FAILED", {
    reason: ["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ENOENT"].includes(code as string)
      ? "MODULE_NOT_FOUND"
      : ["EACCES", "EPERM"].includes(code as string)
        ? "ACCESS_DENIED"
        : ["TransformError", "SyntaxError"].includes(name as string)
          ? "INVALID_SYNTAX"
          : "EXECUTION_FAILED",
  });
}
async function main(args: string[]): Promise<number> {
  json = args.includes("--json");
  const root = process.cwd();
  const command = args[0];
  const rest = args.slice(1);
  const options = new Map<string, string>();
  const flags = new Set<string>();
  if (!command || ((command === "--help" || command === "-h") && args.length === 1)) {
    process.stdout.write(usage.join("\n") + "\n");
    return 0;
  }
  if (
    ["check", "build", "explain", "targets"].includes(command) &&
    rest.length === 1 &&
    ["--help", "-h"].includes(rest[0]!)
  ) {
    process.stdout.write(
      usage.filter((v) => v.startsWith(`proxylang ${command}`)).join("\n") + "\n",
    );
    return 0;
  }
  if (!["check", "build", "explain", "targets"].includes(command))
    return failure("INVALID_ARGUMENTS");
  for (let i = 0; i < rest.length; i++) {
    const option = rest[i]!;
    if (option === "--json" || (command === "build" && option === "--validation")) {
      if (flags.has(option)) return failure("INVALID_ARGUMENTS");
      flags.add(option);
    } else if (
      command === "explain" &&
      ["--profile", "--request", "--request-file"].includes(option)
    ) {
      const value = rest[++i];
      if (!value?.trim() || value.startsWith("--") || options.has(option))
        return failure("INVALID_ARGUMENTS");
      options.set(option, value);
    } else return failure("INVALID_ARGUMENTS");
  }
  if (
    command === "explain" &&
    (!options.has("--profile") || options.has("--request") === options.has("--request-file"))
  )
    return failure("INVALID_ARGUMENTS");
  if (command === "targets") {
    const targets = targetCatalog.flatMap((t) =>
      t.platforms.map((platform) => ({
        engine: t.engine,
        platform,
        version: t.version,
        modes:
          t.engine === "surge"
            ? ["standalone"]
            : t.engine === "stash"
              ? ["fragment"]
              : ["standalone", "fragment"],
        artifact: t.engine === "surge" ? ".conf" : t.engine === "sing-box" ? ".json" : ".yaml",
      })),
    );
    print({ targets });
    return 0;
  }
  const file = resolve(root, "proxylang.config.ts");
  try {
    const info = await lstat(file);
    if (!(info.isSymbolicLink() ? (await stat(file)).isFile() : info.isFile()))
      return loadFailure({ code: "INVALID_CONFIG_FILE" });
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      Object.getOwnPropertyDescriptor(e, "code")?.value === "ENOENT"
    )
      return failure("CONFIG_NOT_FOUND");
    return loadFailure(e);
  }
  const loader = register({ namespace: "proxylang-config" });
  const cjsLoader = registerCjs({ namespace: "proxylang-config" });
  const log = console.log,
    info = console.info;
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  try {
    let sdk = (await loader.import("./index.js", import.meta.url)) as typeof import("./index.js");
    let loaded;
    try {
      loaded = await loader.import(pathToFileURL(file).href, import.meta.url);
    } catch (e) {
      return loadFailure(e);
    }
    const config = loaded.default?.__esModule === true ? loaded.default.default : loaded.default;
    let definition;
    try {
      definition = sdk.defineBuild(config);
    } catch {
      sdk = cjsLoader.require("./index.js", import.meta.url) as typeof import("./index.js");
      try {
        definition = sdk.defineBuild(config);
      } catch {
        return failure("INVALID_BUILD_DEFINITION");
      }
    }
    if (definition.outDir !== undefined)
      definition = sdk.defineBuild({ ...definition, outDir: resolve(root, definition.outDir) });
    const { checkBuild, runBuild } = sdk;
    if (command === "check") {
      const checked = checkBuild(definition);
      print(checked);
      return checked.ok ? 0 : 1;
    }
    if (command === "explain") {
      const checked = checkBuild(definition);
      if (!checked.ok) {
        print(checked);
        return 1;
      }
      if (!Object.hasOwn(definition.profiles, options.get("--profile")!))
        return failure("UNKNOWN_PROFILE");
      return failure("EXPLAIN_PROFILE_UNSUPPORTED");
    }
    const built = await runBuild(definition, { validation: flags.has("--validation") });
    print(built);
    return built.exitCode;
  } finally {
    console.log = log;
    console.info = info;
    cjsLoader.unregister();
    await loader.unregister();
  }
}
try {
  process.exitCode = await main(process.argv.slice(2));
} catch {
  process.exitCode = failure("UNEXPECTED_FAILURE");
}
