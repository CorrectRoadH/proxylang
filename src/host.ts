// @concord-file
// @concord-implements docs/feature/artifact-publication/README.md
import { mkdir, lstat, rename, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathsOverlap } from "./proxies.js";
import { randomUUID } from "node:crypto";
import { render, RenderError } from "./render.js";
import type { Compilation } from "./compiler.js";
import type { Secret } from "./types.js";

export type BuildResult = {
  readonly published: boolean;
  readonly exitCode: 0 | 1 | 2;
  readonly code: string;
  readonly active?: string;
  readonly generation?: string;
};
async function directory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("UNSAFE_DIRECTORY");
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
  try {
    await directory(root);
    try {
      await mkdir(lock, { mode: 0o700 });
      locked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        return { published: false, exitCode: 1, code: "OUTPUT_LOCKED" };
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
  return {
    published,
    exitCode: published ? (cleanupFailed ? 2 : 0) : 1,
    code: cleanupFailed
      ? published
        ? "PUBLISHED_CLEANUP_FAILED"
        : "FAILED_CLEANUP_REQUIRED"
      : code,
    ...(published ? { active: join(root, "active.json"), generation } : {}),
  };
}
