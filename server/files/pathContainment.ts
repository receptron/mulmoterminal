// Path containment shared by the project-scoped file routes (browse + raw serving).
// Trusted-local-user posture: any absolute existing dir is an allowed base, but a
// client-supplied `path` is always contained within that base — no `..` / absolute /
// symlink escape.
import path from "node:path";
import fs from "node:fs";
import { isSamePath, isWithin } from "../infra/fs/path-within.js";
import { unwalkableLinkTarget } from "./linkTargetForm.js";

// Resolve a client-supplied project dir: absolute + existing dir, else the default
// workspace (mirrors index.ts resolveWorkspace). A leading `~` is expanded first — the browser
// cannot, and a clicked `~/Downloads/x.md` arrives with that as its base.
export function resolveBase(cwd: string | null, defaultCwd: string, homeDir: string): string {
  const expanded = cwd === null ? null : expandTilde(cwd, homeDir);
  if (expanded && path.isAbsolute(expanded)) {
    try {
      if (fs.statSync(expanded).isDirectory()) return expanded;
    } catch {
      // not a dir / missing — fall through to the default
    }
  }
  return defaultCwd;
}

/** `resolveBase` for a request that CHANGES files: a cwd that was named but is not an existing
 *  directory is null rather than the default. Falling back is fine for reading; for a rename or a
 *  Trash it would act on a same-named entry in another folder (the pane's folder was removed while
 *  the tree still showed it). No cwd at all still means the default, as everywhere. */
export function namedBase(cwd: string | null, defaultCwd: string, homeDir: string): string | null {
  if (cwd === null || cwd === "") return defaultCwd;
  const base = resolveBase(cwd, defaultCwd, homeDir);
  return base === defaultCwd && path.resolve(expandTilde(cwd, homeDir)) !== path.resolve(defaultCwd) ? null : base;
}

// The serving base for a raw-file request: the workspace root when no cwd is given, or
// the requested cwd ONLY if it is the root or a server-known session directory. Returns
// null when a cwd is given but unauthorized — so a caller can't repoint serving at an
// arbitrary absolute dir via query tampering (the raw route serves file bytes to a
// browser tab, so an unconstrained base is a drive-by read primitive on the loopback).
export function authorizedServingBase(cwd: string | null, root: string, sessionCwds: Iterable<string>): string | null {
  const resolvedRoot = path.resolve(root);
  if (!cwd) return resolvedRoot;
  const requested = path.resolve(cwd);
  // isSamePath, not `===`: on Windows the browser's cwd and the stored session cwd name one
  // directory even when their casing differs, and a raw string compare would refuse to serve.
  if (isSamePath(requested, resolvedRoot)) return requested;
  for (const known of sessionCwds) {
    if (isSamePath(known, requested)) return requested;
  }
  return null;
}

// Expand a leading `~` to the home dir (`~` alone, or `~/…` / `~\…`). Only a leading
// tilde is a home reference; `~user` and a mid-string `~` are left untouched.
export function expandTilde(p: string, homeDir: string): string {
  if (p === "~") return homeDir;
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(homeDir, p.slice(2));
  return p;
}

// Resolve `rel` under `base`; return the absolute path only if it stays within base
// (reject `..` / absolute escapes). null = escapes the root.
export function containedPath(base: string, rel: string): string | null {
  const root = path.resolve(base);
  const abs = path.resolve(root, rel);
  if (!isWithin(root, abs)) return null;
  return abs;
}

/** The absolute path `rel` names under `base`, or null when it escapes.
 *
 *  The whole gate in one call — tilde expanded, contained lexically, then contained again
 *  through symlinks — because BOTH file entry points need exactly this and had it written
 *  out separately: the raw route expanded `~`, the browse routes did not, so the same
 *  clicked path was served by one and refused by the other (#808). */
export function resolveContained(base: string, rel: string, homeDir: string, platform: NodeJS.Platform = process.platform): string | null {
  if (namesAWindowsDevice(rel, platform)) return null;
  const lexical = containedPath(base, expandTilde(rel, homeDir));
  return lexical ? realContainedWithin(base, lexical) : null;
}

/** The absolute path `rel` names under `base` when `resolveContained` refuses it ONLY because a
 *  symlink on the way leads out: inside by its spelling, outside by where it really is. Null for any
 *  other refusal, and for a path that is not refused. */
export function symlinkEscapeOf(base: string, rel: string, homeDir: string, platform: NodeJS.Platform = process.platform): string | null {
  if (namesAWindowsDevice(rel, platform)) return null;
  const lexical = containedPath(base, expandTilde(rel, homeDir));
  return lexical !== null && realContainedWithin(base, lexical) === null ? lexical : null;
}

/** Contain a path a BROWSER named, against the directories this server already serves files
 *  from: the workspace, and the directory of any live session.
 *
 *  The channel name is a client-supplied string, so it goes through the same gate as any other
 *  — `resolveContained` rejects a `..` climb AND a climb through a symlink, which a lexical
 *  check does not (codex on #2147). The root set mirrors `authorizedServingBase`, which the raw
 *  file route uses for the same reason: an unconstrained base is a read primitive on loopback.
 *
 *  A document outside every root simply gets no watcher — the view still works, it just does
 *  not live-refresh, which is what it did before any of this existed.
 *
 *  That is narrower than `presentDocument`, which opens any `.md` on disk with no containment
 *  root at all (backends/files/openPath.ts), and the difference is deliberate: a channel name is a
 *  string a BROWSER chose, while a tool-call path came from an agent the user launched. Closing
 *  the gap means registering the paths those tool calls actually opened and allowing only those
 *  — a trusted-path list, not a wider gate. Until that exists the README says what this covers
 *  rather than claiming the whole of it (codex on #2147, round 5). */
export function containForWatching(roots: Iterable<string>, candidatePath: string, homeDir: string): string | null {
  for (const root of roots) {
    const abs = resolveContained(root, candidatePath, homeDir);
    if (abs) return abs;
  }
  return null;
}

/** Watch the documents Views are subscribed to, so a write from OUTSIDE this app reaches them.
 *
 *  The publisher above only ever hears about this app's own saves. Everything else — the agent
 *  in the next cell, an editor, a checkout — changes the file with nothing to announce it, and
 *  every open view goes quietly stale.
 *
 *  Returns a function that stops listening and every watcher. Shutdown does not need it —
 *  `process.exit` clears the timers — so it is there for a caller that wants the loops gone
 *  while the process stays up.
 *
 *  The announcement goes through `publishFileChange`, so the channel and the payload stay the
 *  ones every View already subscribes to. For a document named by ABSOLUTE path that publish
 *  logs one `[file-change] stat failed` line per change — the shared publisher joins its
 *  argument onto the workspace, as it already does for an absolute save (backends/plugins/markdown.ts).
 *  Cosmetic: the channel is still right, and `mtimeMs` only cache-busts. */

// The DOS device names. Windows resolves them in EVERY directory — `C:\anything\NUL` is the
// null device, not a missing file — so containment says yes and the open lands on a device
// instead of on the project. NUL reads as empty, which is merely wrong; CON blocks until the
// console has input, which hangs the request that asked for it. An extension does not help
// (`CON.txt` is still CON), so the check is on the segment's stem.
//
// Windows only: `con` is a perfectly ordinary filename on POSIX, and refusing it there would
// break a real file for no reason.
// The superscript digits ¹²³ are reserved too, and so are the console's CONIN$/CONOUT$ (Microsoft's
// "Naming Files, Paths, and Namespaces"). Not COM0/LPT0: listed there, but Windows opens them as files,
// and refusing them would lock a real `com0.txt` out of the whole file API.
const DEVICE_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "\u00B9", "\u00B2", "\u00B3"];
const WINDOWS_DEVICE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "CONIN$",
  "CONOUT$",
  ...DEVICE_DIGITS.map((digit) => `COM${digit}`),
  ...DEVICE_DIGITS.map((digit) => `LPT${digit}`),
]);

// ASCII letters only: `toUpperCase` turns a Turkish dotless ı into I, and `conın$` is no device.
const asciiUpper = (text: string): string => text.replace(/[a-z]/g, (letter) => letter.toUpperCase());

// Counted rather than matched: an anchored `[. ]+$` backtracks over a long run.
function trimTrailingDotsAndSpaces(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "." || text[end - 1] === " ")) end--;
  return text.slice(0, end);
}

/** Does any segment of `rel` name a DOS device? Trailing dots and spaces are stripped first,
 *  because Windows strips them too — `NUL. ` opens NUL. */
export function namesAWindowsDevice(rel: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") return false;
  return rel.split(/[\\/]/).some((segment) => {
    // `.` and `:` both end the stem: `CON.txt` is CON, and so is `NUL:$DATA` — a colon opens
    // an NTFS alternate data stream (and `NUL:` is the legacy device spelling), neither of
    // which stops the name in front of it being a device.
    const stem = trimTrailingDotsAndSpaces(segment.split(/[.:]/)[0] ?? "");
    return WINDOWS_DEVICE_NAMES.has(asciiUpper(stem));
  });
}

export function realpathOr(p: string): string {
  try {
    // .native, not the JS implementation: on Windows only the native call expands an 8.3 short
    // component (C:\Users\RUNNER~1 -> ...\runneradmin). Both sides of the containment check
    // below go through here, so they agree either way — but a caller comparing against a path
    // resolved elsewhere would not. Same reason git/worktrees.ts uses it.
    return fs.realpathSync.native(p);
  } catch {
    return p; // doesn't exist yet (a new file being written) — use the lexical path
  }
}

// Lexical containment (containedPath) can be defeated by a SYMLINK inside the project
// that points outside it. This resolves symlinks in the path's existing portion (a
// not-yet-created write target has none) and confirms the real path still lands within
// `base`. Returns the real absolute path, or null if it escapes.
export function realContainedWithin(base: string, absLexical: string): string | null {
  const root = realpathOr(path.resolve(base));
  const real = realLocationOrNull(absLexical);
  return real !== null && isWithin(root, real) ? real : null;
}

// A link removed or swapped between the lstat and the readlink makes those throw: refuse rather than
// fail the request, since where the path leads could not be established.
function realLocationOrNull(abs: string): string | null {
  try {
    return realLocationOf(abs, { hopsLeft: MAX_LINK_HOPS });
  } catch {
    return null;
  }
}

// Dangling links one resolution may follow before it refuses. The kernel gives up in the same range
// (SYMLOOP_MAX), and a cycle never ends at all. One budget for the whole resolution, nested links
// included: a count per call would let targets that name other dangling links multiply the work.
const MAX_LINK_HOPS = 40;
interface LinkBudget {
  hopsLeft: number;
}

/** Where `abs` really is: its existing portion resolved through symlinks, the not-yet-created rest
 *  appended. A DANGLING link is part of the existing portion and is followed to where it points,
 *  because a write through it creates the file there — `existsSync` follows the link and would call
 *  it absent. Null when the links do not end. */
function realLocationOf(abs: string, budget: LinkBudget): string | null {
  const { existing, rest } = splitAtLastEntry(abs);
  const real = realEntry(existing, budget);
  return real === null ? null : path.resolve(real, ...rest);
}

function splitAtLastEntry(abs: string): { existing: string; rest: string[] } {
  const rest: string[] = [];
  let existing = abs;
  while (!hasEntry(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break; // reached the filesystem root
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  return { existing, rest };
}

function isExistingNonDirectory(p: string): boolean {
  try {
    return !fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// lstat, not exists: a link whose target is missing is still an entry here.
function hasEntry(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** The real path of an entry that exists. A link that does not resolve to the end (its target is
 *  missing, or the links loop) is followed to where it points, which is where a write through it lands. */
function realEntry(entry: string, budget: LinkBudget): string | null {
  try {
    return fs.realpathSync.native(entry);
  } catch {
    // dangling, looping, or unreadable: decided below
  }
  if (!fs.lstatSync(entry).isSymbolicLink()) return entry;
  if (budget.hopsLeft <= 0) return null;
  budget.hopsLeft -= 1;
  // From the folder's REAL path, as the OS does: the spelling may have reached it through another link.
  return followTarget(realpathOr(path.dirname(entry)), fs.readlinkSync(entry), budget);
}

// A backslash is a separator only on Windows; on POSIX it is a character a name may contain.
const TARGET_SEPARATORS = path.sep === "\\" ? /[\\/]+/ : /\/+/;

/** Where a link's target leads, walked one component at a time as the OS walks it: a link met on the
 *  way is followed BEFORE a later `..` applies. `path.resolve` would cancel `hop/..` on paper first,
 *  and land somewhere the link does not point. */
function followTarget(realFolder: string, target: string, budget: LinkBudget): string | null {
  if (unwalkableLinkTarget(target, process.platform)) return null;
  const root = path.isAbsolute(target) ? path.parse(target).root : "";
  const parts = target.slice(root.length).split(TARGET_SEPARATORS);
  return parts.reduce<string | null>((at, part) => (at === null ? null : stepInto(at, part, budget)), root === "" ? realFolder : root);
}

function stepInto(at: string, part: string, budget: LinkBudget): string | null {
  // The OS stops at a file with more of the path after it (ENOTDIR); going on would answer a path
  // the link does not lead to.
  if (part !== "" && isExistingNonDirectory(at)) return null;
  if (part === "" || part === ".") return at;
  if (part === "..") return path.dirname(at);
  const next = path.join(at, part);
  return hasEntry(next) ? realEntry(next, budget) : next;
}
