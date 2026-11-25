// The Files pane tree's own file operations (#2578): a new file or folder, a rename, and a delete
// that moves the entry to the system Trash rather than destroying it.
//
// Every one acts on the ENTRY the tree shows — a symlink is renamed or trashed as a link, never
// followed — and inside the pane's root: the path is contained lexically, its parent directory is
// contained through symlinks, and the root itself is never an entry. A rename keeps the entry in its
// directory; moving between directories is not offered.
//
// Deleting is offered only where the Trash is known: macOS's `~/.Trash`, and the freedesktop Trash on
// Linux. Elsewhere there is no delete at all, rather than a delete that cannot be undone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { containedPath, namesAWindowsDevice, realContainedWithin } from "./pathContainment.js";
import { isSamePath } from "../infra/fs/path-within.js";
import { createFileVerified, type Recheck, type VerifiedOutcome } from "./verifiedWrite.js";
import { isSameIdentity, type FileIdentity } from "./fileIdentity.js";
import { makeFolderVerified } from "./verifiedMkdir.js";

/** The longest name a new entry may have: what the common filesystems allow, in bytes. */
const MAX_NAME_BYTES = 255;

/** A name for an entry in one directory: no separator, no NUL, not `.` or `..`, not blank. On
 *  Windows also no `:` (an NTFS alternate stream of another file) and no device name (`CON`). */
export function validEntryName(name: unknown, platform: NodeJS.Platform = process.platform): name is string {
  if (typeof name !== "string" || name.trim() === "" || name === "." || name === "..") return false;
  if (/[/\\\0]/.test(name)) return false;
  if (platform === "win32" && (name.includes(":") || namesAWindowsDevice(name, platform))) return false;
  return Buffer.byteLength(name, "utf8") <= MAX_NAME_BYTES;
}

/** The entry `rel` names under `base`, as the tree shows it: its parent resolved through symlinks
 *  and contained, its own last component left as it is. Null when it escapes, or names the root.
 *
 *  No `~` expansion, unlike the read routes: a tree path is always relative to the base, and a
 *  folder literally named `~` (a quoted `mkdir "~/x"` leaves one) must not send a rename or a
 *  delete into the real home directory. */
export function entryUnder(base: string, rel: string, platform: NodeJS.Platform = process.platform): string | null {
  if (namesAWindowsDevice(rel, platform)) return null;
  const lexical = containedPath(base, rel);
  if (!lexical || isSamePath(lexical, path.resolve(base))) return null;
  const parent = realContainedWithin(base, path.dirname(lexical));
  return parent ? path.join(parent, path.basename(lexical)) : null;
}

/** Whether anything, a dangling symlink included, is at `abs`. Only "no such entry" is no: any
 *  other failure (a permission refused on the Trash, say) counts as taken, so a name is never
 *  picked on the strength of an error and then replaced by a rename. */
export const entryExists = (abs: string): boolean => {
  try {
    fs.lstatSync(abs);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"));
  }
};

export type EntryKind = "file" | "dir";

/** Make an empty file or a folder. Never over something that is there: `wx` and `mkdir` both fail
 *  on an existing name, so a race with another writer cannot turn a create into an overwrite. */
export function createEntry(abs: string, kind: EntryKind, recheck: Recheck): VerifiedOutcome {
  return kind === "file" ? createFileVerified(abs, recheck) : makeFolderVerified(abs, recheck);
}

// A rename or a move to the Trash acts by name after the containment check, and Node has no
// `renameat`, so a folder above the entry swapped for a link out in between moves an OUTSIDE entry
// (#3306). It cannot be stopped beforehand, so it is detected: the entry is identified (device and
// inode) just before the move, and afterwards the check is asked again and must name a place holding
// that same entry. A move that landed outside is reported, not undone — putting it back by name would
// be another check-then-act. A swap made before the entry is identified and undone before the check is
// asked again still passes.
const identityOf = (abs: string): FileIdentity | null => {
  const stats = fs.lstatSync(abs, { bigint: true, throwIfNoEntry: false });
  return stats ? { dev: stats.dev, ino: stats.ino } : null;
};

const holds = (abs: string | null, entry: FileIdentity | null): boolean => {
  const now = abs === null ? null : identityOf(abs);
  return entry !== null && now !== null && isSameIdentity(now, entry);
};

/** Rename in place. A name that differs only in case is the same entry on a case-insensitive disk,
 *  so that one is allowed through; any other existing name is refused. `recheckTo` is the check for
 *  the NEW name: "escaped" when, after the rename, it does not name the entry that was moved.
 *
 *  A file created at `to` between the check and the rename is replaced (POSIX `rename` does that). A
 *  link-then-unlink rename would refuse it, but where the old name cannot be removed (a deny-delete
 *  ACL, another user's file in a sticky folder) it leaves the file under BOTH names with no way back —
 *  worse than the race it closes, so it is not done (#2694). */
export function renameEntry(from: string, to: string, recheckTo: Recheck): "renamed" | "exists" | "escaped" {
  const sameEntry =
    from.toLowerCase() === to.toLowerCase() && entryExists(to) && isSameIdentity(fs.lstatSync(from, { bigint: true }), fs.lstatSync(to, { bigint: true }));
  if (entryExists(to) && !sameEntry) return "exists";
  const moving = identityOf(from);
  fs.renameSync(from, to);
  return holds(recheckTo(), moving) ? "renamed" : "escaped";
}

/** Where deleted entries go on this machine, or null where it is not known. */
export type TrashLayout = { kind: "mac"; files: string } | { kind: "freedesktop"; files: string; info: string } | null;

// POSIX paths throughout: both layouts exist only on POSIX systems, and a spec computing them on
// Windows must get the same answer.
export function trashLayout(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, homeDir: string): TrashLayout {
  if (platform === "darwin") return { kind: "mac", files: path.posix.join(homeDir, ".Trash") };
  if (platform !== "linux") return null;
  const dataHome = env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.posix.join(homeDir, ".local", "share");
  const trash = path.posix.join(dataHome, "Trash");
  return { kind: "freedesktop", files: path.posix.join(trash, "files"), info: path.posix.join(trash, "info") };
}

/** This machine's own Trash. */
export const systemTrash = (): TrashLayout => trashLayout(process.platform, process.env, os.homedir());

/** How many names are tried before the Trash is given up on: an error that repeats for every name
 *  (an unreadable Trash) must end the search, not spin the server's one thread. */
export const MAX_TRASH_NAME_TRIES = 1000;
/** Room left in a 255-byte name for the freedesktop `.trashinfo` suffix. */
const TRASH_NAME_BYTES = MAX_NAME_BYTES - ".trashinfo".length;

/** `stem` cut, by whole characters, so `stem + suffix` fits in `maxBytes`. */
function fitted(stem: string, suffix: string, maxBytes: number): string {
  const chars = [...stem];
  while (chars.length > 1 && Buffer.byteLength(chars.join("") + suffix, "utf8") > maxBytes) chars.pop();
  return chars.join("") + suffix;
}

/** A name not yet taken in the Trash: `a.txt`, then `a 2.txt`, `a 3.txt`, … as a file manager does,
 *  each kept short enough for its `.trashinfo` beside it. Null when none is free within the tries. */
export function freeTrashName(name: string, taken: (candidate: string) => boolean): string | null {
  const ext = path.extname(name);
  // An extension too long to keep beside a numbered stem is cut with the rest of the name: the entry
  // is trashed under a shorter name rather than not at all (its `.trashinfo` keeps the original).
  // Measured with the name's own first character, the least of the stem `fitted` keeps — it may be
  // several bytes.
  const shortestStem = [...name][0] ?? "";
  const keepsExt = ext && ext !== name && Buffer.byteLength(`${shortestStem} ${MAX_TRASH_NAME_TRIES}${ext}`, "utf8") <= TRASH_NAME_BYTES;
  const stem = keepsExt ? name.slice(0, -ext.length) : name;
  const suffix = keepsExt ? ext : "";
  for (let n = 1; n <= MAX_TRASH_NAME_TRIES; n++) {
    const candidate = fitted(stem, n === 1 ? suffix : ` ${n}${suffix}`, TRASH_NAME_BYTES);
    if (!taken(candidate)) return candidate;
  }
  return null;
}

/** The freedesktop `.trashinfo` for an entry, which is what lets a file manager restore it. */
export function trashInfo(originalAbs: string, deletedAt: Date): string {
  const encoded = originalAbs.split("/").map(encodeURIComponent).join("/");
  const pad = (n: number): string => String(n).padStart(2, "0");
  const d = deletedAt;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `[Trash Info]\nPath=${encoded}\nDeletionDate=${date}\n`;
}

/** Move an entry into the Trash. `rename`, so an entry on another volume than the Trash is refused
 *  (EXDEV) rather than copied and deleted — a delete must not be the only copy's last step. `recheck`
 *  is the entry's own check: "escaped" when, after the move, it no longer names a place inside, or what
 *  reached the Trash is not the entry that was identified before the move. */
export function moveToTrash(abs: string, layout: NonNullable<TrashLayout>, now: Date, recheck: Recheck): TrashMove["outcome"] {
  return trashEntry(abs, layout, now, recheck).outcome;
}

/** Where an entry went in the Trash, and its freedesktop info file: what putting it back needs. */
export type TrashMove = { outcome: "trashed" | "other-volume" | "escaped"; target: string; info: string | null };

/** `moveToTrash`, also saying where the entry landed. */
export function trashEntry(abs: string, layout: NonNullable<TrashLayout>, now: Date, recheck: Recheck): TrashMove {
  fs.mkdirSync(layout.files, { recursive: true, mode: 0o700 });
  if (layout.kind === "freedesktop") fs.mkdirSync(layout.info, { recursive: true, mode: 0o700 });
  const infoFor = (name: string): string | null => (layout.kind === "freedesktop" ? path.join(layout.info, `${name}.trashinfo`) : null);
  const name = freeTrashName(path.basename(abs), (candidate) => {
    const info = infoFor(candidate);
    return entryExists(path.join(layout.files, candidate)) || (info !== null && entryExists(info));
  });
  if (name === null) throw new Error("no free name in the Trash");
  const info = infoFor(name);
  // The info file first, with `wx`: it reserves the name, and an entry in `files/` with no info is
  // one the file manager cannot put back.
  if (info) fs.writeFileSync(info, trashInfo(abs, now), { flag: "wx", mode: 0o600 });
  const target = path.join(layout.files, name);
  const moving = moveUnlessReleased(abs, target, info);
  if (moving === "other-volume") return { outcome: moving, target, info };
  // Checked only once the move is done: the info file then describes what is in the Trash, whatever
  // the check says, and must stay so the entry can be put back.
  return { outcome: recheck() !== null && holds(target, moving) ? "trashed" : "escaped", target, info };
}

/** Move `abs` to `target`, with the identity it had just before; when the move fails, the reserved
 *  info file is released, and a move across volumes is "other-volume". */
function moveUnlessReleased(abs: string, target: string, info: string | null): FileIdentity | null | "other-volume" {
  try {
    const moving = identityOf(abs);
    fs.renameSync(abs, target);
    return moving;
  } catch (error) {
    if (info) fs.rmSync(info, { force: true });
    if (error instanceof Error && "code" in error && error.code === "EXDEV") return "other-volume";
    throw error;
  }
}
