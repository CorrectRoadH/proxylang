// @concord-file
// @concord-implements docs/feature/artifact-publication/use-case/publish-generation.md
import { mkdir, lstat, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export class SurgePublishError extends Error {
  constructor(
    message: string,
    readonly published: boolean,
  ) {
    super(message);
  }
}

// One pointer switch publishes the complete batch. Previous generations remain recoverable.
// The rename seam is an I/O boundary for fault-injection tests, not a second publication path.
export async function publishProfiles(
  files: ReadonlyMap<string, string>,
  surgeDirectory: string,
  io: { rename: typeof rename; rm?: typeof rm } = { rename },
): Promise<void> {
  if (
    !files.size ||
    files.size > 16 ||
    [...files.keys()].some((name) => !/^[a-z0-9][a-z0-9-]*\.conf$/.test(name))
  )
    throw new Error("INVALID_PROFILE_FILENAMES");
  const root = resolve(surgeDirectory);
  const generations = join(root, ".generations");
  const id = randomUUID();
  const generation = join(generations, id);
  const pointer = join(root, `.out-${id}`);
  const output = join(root, "out");
  const backup = join(generations, `legacy-${id}`);
  const lock = join(root, ".build-lock");
  const remove = io.rm ?? rm;
  let failure: Error | undefined;
  let locked = false,
    created = false,
    committed = false,
    movedLegacy = false,
    recoveryFailed = false;
  async function directory(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("UNSAFE_OUTPUT_DIRECTORY");
  }
  try {
    await directory(root);
    try {
      await mkdir(lock, { mode: 0o700 });
      locked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("OUTPUT_LOCKED");
      throw error;
    }
    await directory(generations);
    let previous: Awaited<ReturnType<typeof lstat>> | undefined;
    try {
      previous = await lstat(output);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous?.isSymbolicLink()) {
      const target = await readlink(output);
      if (!/^\.generations\/(?:legacy-)?[a-f0-9-]{36}$/.test(target))
        throw new Error("UNMANAGED_OUTPUT_LINK");
      const stat = await lstat(join(root, target));
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("UNSAFE_OUTPUT_DIRECTORY");
    } else if (previous && !previous.isDirectory()) throw new Error("UNSAFE_OUTPUT_DIRECTORY");
    await mkdir(generation, { mode: 0o700 });
    created = true;
    for (const [name, content] of files)
      await writeFile(join(generation, name), content, { mode: 0o600, flag: "wx" });
    await symlink(`.generations/${id}`, pointer, "dir");
    if (previous?.isDirectory()) {
      await io.rename(output, backup);
      movedLegacy = true;
    }
    try {
      await io.rename(pointer, output);
      committed = true;
    } catch (error) {
      if (movedLegacy) {
        try {
          await io.rename(backup, output);
          movedLegacy = false;
        } catch {
          recoveryFailed = true;
          throw new Error("PUBLISH_RECOVERY_REQUIRED");
        }
      }
      throw error;
    }
  } catch (error) {
    const code =
      error instanceof Error &&
      /^(?:INVALID_PROFILE_FILENAMES|OUTPUT_LOCKED|UNMANAGED_OUTPUT_LINK|UNSAFE_OUTPUT_DIRECTORY|PUBLISH_RECOVERY_REQUIRED)$/.test(
        error.message,
      )
        ? error.message
        : "PROFILE_PUBLISH_FAILED";
    failure = new Error(code);
  } finally {
    // Never discard rollback evidence after a failed legacy-directory restoration.
    if (!recoveryFailed) {
      try {
        await remove(pointer, { force: true });
        if (created && !committed) await remove(generation, { recursive: true, force: true });
        if (locked) await remove(lock, { recursive: true, force: true });
      } catch {
        failure ??= new Error("PROFILE_PUBLISH_CLEANUP_FAILED");
      }
    }
  }
  if (failure)
    throw new SurgePublishError(
      failure.message === "PROFILE_PUBLISH_CLEANUP_FAILED"
        ? committed
          ? "PUBLISHED_CLEANUP_FAILED"
          : "FAILED_CLEANUP_REQUIRED"
        : failure.message,
      committed,
    );
}
