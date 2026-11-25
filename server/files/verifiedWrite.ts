// A containment check and the write after it are two steps, and a folder on the path can be swapped
// for a link out of the project in between (#3306). These open first and then ask the check again:
// the write goes ahead only if the open file IS the file (device and inode) the check now names.
//
// Node has no `openat`, so the open itself can still land outside. A swap before the open is caught,
// and so is one undone before the re-check, since the check then names the inside file. What it does
// not hold:
// - the identity is looked up by NAME, so three swaps each timed to the instant (out before the open,
//   back before the re-check, out again before that lookup) still pass it. Once it passes, the write
//   itself goes through the descriptor, so a later rename cannot move it. Binding the lookup to the
//   open file needs its path from the descriptor: Linux's /proc/self/fd gives one, macOS's /dev/fd
//   answers only what fstat does (readlink is EINVAL there), and Node has no portable call.
// - a file the open had to create outside is left there, EMPTY. Removing it by name would be a second
//   check-then-act, and a swap in that gap would delete someone else's file.
// - a hard link (or a bind mount) is the same file by device and inode, so writing to one inside the
//   project changes it wherever else it appears. That is what a hard link is, not a path escaping.
import fs from "node:fs";
import { isSameIdentity } from "./fileIdentity.js";

/** The check, asked again: the contained real path, or null when the path now escapes. */
export type Recheck = () => string | null;

export type VerifiedOutcome = "written" | "escaped";

// Where the platform has it, a link as the LAST component is refused by the open itself (ELOOP).
export const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** Replace `abs`'s contents with `bytes`, or create it. Nothing is truncated before the check passes,
 *  so an escaped write leaves the file it reached as it was. */
export function writeVerified(abs: string, bytes: Buffer, recheck: Recheck): VerifiedOutcome {
  // Never `O_TRUNC`: the contents are only replaced once the check has passed.
  const fd = openUnlessLink(abs, fs.constants.O_WRONLY | fs.constants.O_CREAT | NO_FOLLOW);
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

/** `abs` opened with `flags`, or null when its last component is a link `NO_FOLLOW` refused. */
export function openUnlessLink(abs: string, flags: number): number | null {
  try {
    return fs.openSync(abs, flags);
  } catch (error) {
    if (isCode(error, "ELOOP")) return null;
    throw error;
  }
}

export const isSameFile = (fd: number, contained: string | null): boolean => {
  try {
    return isOpenedFileAt(fs.fstatSync(fd, { bigint: true }), contained);
  } catch {
    return false;
  }
};

/** Whether the file `opened` describes is the one at `contained`, the path the check answered. */
export function isOpenedFileAt(opened: fs.BigIntStats, contained: string | null): boolean {
  if (contained === null) return false;
  try {
    return isSameIdentity(opened, fs.statSync(contained, { bigint: true }));
  } catch {
    return false;
  }
}

const isCode = (error: unknown, code: string): boolean => error instanceof Error && "code" in error && error.code === code;
