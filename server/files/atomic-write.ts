import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hasErrnoCode } from "../errors.js";

// Write a state file so a crash mid-write can't leave a truncated one behind: write a
// unique temp then rename (atomic on POSIX + Windows), mkdir -p the parent first. The
// unique name is what lets two writers use this concurrently without trampling a temp.

// Windows only: a rename onto an existing destination fails outright when something
// holds that file for even an instant — a concurrent writer's own rename, an indexer,
// or a virus scanner. POSIX rename just wins the race, so these retries are what make
// the concurrency promise above hold on Windows too.
const RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200];
const RENAME_CONTENTION_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/** Whether a failed rename is worth retrying: a transient lock on the destination,
 *  not a real problem like a missing directory (ENOENT) or a full disk (ENOSPC). */
export function isRenameContention(err: unknown): boolean {
  return hasErrnoCode(err) && typeof err.code === "string" && RENAME_CONTENTION_CODES.has(err.code);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** rename, retried while the destination is briefly locked. `renameFile` and `wait` are
 *  injected so the retry behavior can be tested without a Windows host to lock a file. */
export async function renameWithRetry(
  tmp: string,
  filePath: string,
  renameFile: (from: string, to: string) => Promise<void> = rename,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<void> {
  for (const delay_ms of RENAME_RETRY_DELAYS_MS) {
    try {
      return await renameFile(tmp, filePath);
    } catch (err) {
      if (!isRenameContention(err)) throw err;
      await wait(delay_ms);
    }
  }
  // Out of retries: let the last attempt's error reach the caller rather than reporting success.
  return await renameFile(tmp, filePath);
}

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmp, content);
  await renameWithRetry(tmp, filePath);
}
