// A containment check and the write after it are two steps, and a folder on the path can be swapped
// for a link out of the project in between (#3306). These open first and then ask the check again:
// the write goes ahead only if the open file IS the file (device and inode) the check now names.
//
// Node has no `openat`, so the open itself can still land outside. What this holds is that nothing is
// written there: a swap that is undone before the re-check still fails the comparison, since the check
// then names the inside file. What it does not hold:
// - a file the open had to create outside is left there, EMPTY. Removing it by name would be a second
//   check-then-act, and a swap in that gap would delete someone else's file.
// - a hard link (or a bind mount) is the same file by device and inode, so writing to one inside the
//   project changes it wherever else it appears. That is what a hard link is, not a path escaping.
import fs from "node:fs";

/** The check, asked again: the contained real path, or null when the path now escapes. */
export type Recheck = () => string | null;

export type VerifiedOutcome = "written" | "escaped";

// Where the platform has it, a link as the LAST component is refused by the open itself (ELOOP).
const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** Replace `abs`'s contents with `bytes`, or create it. Nothing is truncated before the check passes,
 *  so an escaped write leaves the file it reached as it was. */
export function writeVerified(abs: string, bytes: Buffer, recheck: Recheck): VerifiedOutcome {
  const fd = openForWrite(abs);
  if (fd === null) return "escaped";
  try {
    if (!isSameFile(fd, recheck())) return "escaped";
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, bytes);
    return "written";
  } finally {
    fs.closeSync(fd);
  }
}

/** Create `abs` as an empty file, never over anything already there. */
export function createFileVerified(abs: string, recheck: Recheck): VerifiedOutcome {
  const fd = fs.openSync(abs, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW);
  try {
    return isSameFile(fd, recheck()) ? "written" : "escaped";
  } finally {
    fs.closeSync(fd);
  }
}

/** The file open for writing, created when absent, or null when the last component is a link. Never
 *  `O_TRUNC`: the contents are only replaced once the check has passed. */
function openForWrite(abs: string): number | null {
  try {
    return fs.openSync(abs, fs.constants.O_WRONLY | fs.constants.O_CREAT | NO_FOLLOW);
  } catch (error) {
    if (isCode(error, "ELOOP")) return null;
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

const isCode = (error: unknown, code: string): boolean => error instanceof Error && "code" in error && error.code === code;
