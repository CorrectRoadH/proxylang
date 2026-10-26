// @concord-file
// @concord-implements docs/feature/artifact-publication/README.md
import { mkdir, lstat, rename, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathsOverlap } from "./proxies.js";
import { randomUUID } from "node:crypto";
import { render, RenderError } from "./render.js";
import type { Compilation } from "./compiler.js";
import { secretFailure, type SecretFailure } from "./secrets.js";
import type { Secret } from "./types.js";

export type BuildResult = SecretFailure & {
  readonly published: boolean;
  readonly exitCode: 0 | 1 | 2;
  readonly code: string;
  readonly paths?: readonly string[];
  readonly active?: string;
  readonly generation?: string;
  readonly reason?: "ACCESS_DENIED" | "NO_SPACE" | "READ_ONLY" | "INVALID_DIRECTORY" | "IO_ERROR";
  readonly hint?: string;
};
const buildHints: Readonly<Record<string, string>> = {
  INVALID_OUTPUT_DIRECTORY: "提供非空输出目录路径",
  OUTPUT_LOCKED: "确认没有构建正在运行；检查并处理遗留锁后重试，不要删除仍在使用的锁",
  SECRET_MISSING: "在构建环境提供配置引用的非空秘密变量",
  SECRET_RESOLUTION_FAILED: "检查秘密解析器；原始异常不会进入构建报告",
  PUBLISHED_CLEANUP_FAILED: "活动指针已经切换；检查残留锁和临时文件，不要假设发布失败",
  FAILED_CLEANUP_REQUIRED: "旧活动指针保留；检查本次残留产物和锁后重试",
};
function outputFailure(error: unknown): Pick<BuildResult, "reason" | "hint"> {
  const code =
    error && typeof error === "object"
      ? Object.getOwnPropertyDescriptor(error, "code")?.value
      : undefined;
  if (code === "EACCES" || code === "EPERM")
    return { reason: "ACCESS_DENIED", hint: "检查输出目录的写入和遍历权限" };
  if (code === "ENOSPC" || code === "EDQUOT")
    return { reason: "NO_SPACE", hint: "释放磁盘空间或调整存储配额后重试" };
  if (code === "EROFS") return { reason: "READ_ONLY", hint: "选择可写的本地输出目录" };
  if (["ENOTDIR", "EISDIR", "EEXIST", "UNSAFE_DIRECTORY"].includes(code))
    return {
      reason: "INVALID_DIRECTORY",
      hint: "检查输出根、generations 和 active.json 的文件类型；输出目录不能是符号链接",
    };
  return {
    reason: "IO_ERROR",
    hint: "检查输出目录及文件系统状态，旧活动配置在发布前失败时保持不变",
  };
}
async function directory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Object.assign(new Error("UNSAFE_DIRECTORY"), { code: "UNSAFE_DIRECTORY" });
}

/** All targets publish together by one active.json rename. Config files never go to stdout. */
// @concord-code
// @concord-implements docs/feature/artifact-publication/use-case/publish-generation.md
export async function buildToDirectory(
  compilation: Compilation,
  output: string,
  resolveSecret: (token: Secret) => string | undefined = (token) => process.env[token.name],
): Promise<BuildResult> {
  if (!compilation.ok) return { published: false, exitCode: 1, code: "COMPILATION_FAILED" };
  if (typeof output !== "string" || !output.trim())
    return {
      published: false,
      exitCode: 1,
      code: "INVALID_OUTPUT_DIRECTORY",
      hint: buildHints.INVALID_OUTPUT_DIRECTORY,
    };
  const root = resolve(output);
  if (
    compilation.plans.some((plan) =>
      plan.program.endpoints?.some((endpoint) => pathsOverlap(root, endpoint.stateDirectory)),
    )
  )
    return { published: false, exitCode: 1, code: "ENDPOINT_STATE_OVERLAP" };
  const lock = join(root, ".proxylang-lock");
  const id = randomUUID();
  const relativeGeneration = `generations/${id}`;
  const generation = join(root, relativeGeneration);
  const pointer = join(root, `.active-${id}.json`);
  let locked = false;
  let created = false;
  let published = false;
  let code = "BUILD_FAILED";
  let cleanupFailed = false;
  let detail: Pick<BuildResult, "reason" | "hint"> & SecretFailure = {};
  try {
    await directory(root);
    try {
      await mkdir(lock, { mode: 0o700 });
      locked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        return {
          published: false,
          exitCode: 1,
          code: "OUTPUT_LOCKED",
          hint: buildHints.OUTPUT_LOCKED,
        };
      throw error;
    }
    const artifacts = render(compilation, resolveSecret);
    await directory(join(root, "generations"));
    await mkdir(generation, { mode: 0o700 });
    created = true;
    for (const artifact of artifacts)
      await writeFile(join(generation, artifact.filename), artifact.content, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
    const manifest = {
      schemaVersion: 1,
      targets: compilation.plans.map((plan) => ({
        target: plan.target,
        sourceMap: plan.sourceMap,
        strategySelections: plan.strategySelections,
        preconditions: plan.preconditions,
        nativeValidation: plan.nativeValidation,
      })),
      diagnostics: compilation.diagnostics,
      cases: compilation.cases,
      artifacts: artifacts.map((artifact) => ({
        target: artifact.target,
        filename: artifact.filename,
      })),
    };
    await writeFile(join(generation, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    const active = {
      schemaVersion: 1,
      generation: relativeGeneration,
      manifest: `${relativeGeneration}/manifest.json`,
      artifacts: Object.fromEntries(
        artifacts.map((artifact) => [
          artifact.target,
          `${relativeGeneration}/${artifact.filename}`,
        ]),
      ),
    };
    await writeFile(pointer, JSON.stringify(active, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(pointer, join(root, "active.json"));
    published = true;
    code = "PUBLISHED";
  } catch (error) {
    code = error instanceof RenderError ? error.code : "OUTPUT_FAILED";
    detail =
      error instanceof RenderError
        ? { hint: buildHints[code], ...secretFailure(error) }
        : outputFailure(error);
  } finally {
    if (locked) {
      try {
        await rm(pointer, { force: true });
      } catch {
        cleanupFailed = true;
      }
      if (created && !published)
        try {
          await rm(generation, { recursive: true });
        } catch {
          cleanupFailed = true;
        }
      try {
        await rm(lock, { recursive: true });
      } catch {
        cleanupFailed = true;
      }
    }
  }
  const resultCode = cleanupFailed
    ? published
      ? "PUBLISHED_CLEANUP_FAILED"
      : "FAILED_CLEANUP_REQUIRED"
    : code;
  return {
    published,
    exitCode: published ? (cleanupFailed ? 2 : 0) : 1,
    code: resultCode,
    ...detail,
    ...(buildHints[resultCode] ? { hint: buildHints[resultCode] } : {}),
    ...(published ? { active: join(root, "active.json"), generation } : {}),
  };
}
