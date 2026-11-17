// A containment check and the write after it are two steps, and a folder on the path can be swapped
// for a link out of the project in between (#3306). These open first and then ask the check again:
// the write goes ahead only if the open file IS the file (device and inode) the check now names.
//
// Node has no `openat`, so the open itself can still land outside. What this holds is that nothing is
// written there: a swap that is undone before the re-check still fails the comparison, since the check
// then names the inside file. A file the open had to create outside is removed again.
import fs from "node:fs";

/** The check, asked again: the contained real path, or null when the path now escapes. */
export type Recheck = () => string | null;

export type VerifiedOutcome = "written" | "escaped";

// Where the platform has it, a link as the LAST component is refused by the open itself (ELOOP).
const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** Replace `abs`'s contents with `bytes`, or create it. Nothing is truncated before the check passes,
 *  so an escaped write leaves the file it reached as it was — and one it created is removed again. */
export function writeVerified(abs: string, bytes: Buffer, recheck: Recheck): VerifiedOutcome {
  const opened = openForWrite(abs);
  if (opened === null) return "escaped";
  try {
    if (!isSameFile(opened.fd, recheck())) {
      if (opened.created) removeIfStill(abs, opened.fd);
      return "escaped";
    }
    fs.ftruncateSync(opened.fd, 0);
    fs.writeFileSync(opened.fd, bytes);
    return "written";
  } finally {
    fs.closeSync(opened.fd);
  }
}

/** Create `abs` as an empty file, never over anything already there. An escaped one is removed. */
export function createFileVerified(abs: string, recheck: Recheck): VerifiedOutcome {
  const fd = fs.openSync(abs, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW);
  try {
    if (isSameFile(fd, recheck())) return "written";
    removeIfStill(abs, fd);
    return "escaped";
  } finally {
    fs.closeSync(fd);
  }
}

/** The open file and whether this open created it, or null when the last component is a link. */
function openForWrite(abs: string): { fd: number; created: boolean } | null {
  try {
    return { fd: fs.openSync(abs, fs.constants.O_WRONLY | NO_FOLLOW), created: false };
  } catch (error) {
    if (isCode(error, "ELOOP")) return null;
    if (!isCode(error, "ENOENT")) throw error;
  }
  try {
    return { fd: fs.openSync(abs, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW), created: true };
  } catch (error) {
    if (isCode(error, "ELOOP") || isCode(error, "EEXIST")) return null;
    throw error;
  }
}

// bigint: a Windows file id is 64 bits, and a number loses the low ones.
function isSameFile(fd: number, contained: string | null): boolean {
  if (contained === null) return false;
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const named = fs.statSync(contained, { bigint: true });
    return opened.dev === named.dev && opened.ino === named.ino;
  } catch {
    return false;
  }
}

// By name, so only while the name still leads to the file this call created: a second swap in between
// must not turn the clean-up into a delete of someone else's file.
function removeIfStill(abs: string, fd: number): void {
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const named = fs.lstatSync(abs, { bigint: true });
    if (opened.dev === named.dev && opened.ino === named.ino) fs.unlinkSync(abs);
  } catch {
    // gone already, or no longer ours: leave it
  }
}

const isCode = (error: unknown, code: string): boolean => error instanceof Error && "code" in error && error.code === code;
