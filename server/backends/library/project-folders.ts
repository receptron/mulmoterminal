// Which directory a project folder under Claude Code's projects root belongs to (#3334). One rule for
// every caller — the Memory view, the memory health check and the tidy-up route: a folder's directory
// is the ONE directory the Library's index knows whose folder name, made by Claude Code's own rule, is
// that folder's. Claude Code names the folder after the directory's real path (links resolved, the
// case the disk spells) encoded by `encodeProjectDirName`, so that is what is compared; two directories
// with one folder name leave it unknown rather than guessed.
//
// Resolving real paths is file-system work over every directory the index knows (thousands), so it is
// done asynchronously in batches, off the event loop's critical path, and kept for REALPATH_MEMO_MS.
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { encodeProjectDirName, REALPATH_MEMO_MS } from "../../session/project-dir.js";

/** How many real paths are asked for at once. */
const RESOLVE_AT_ONCE = 64;

const nativeRealpath = promisify(fs.realpath.native);

export type RealPath = (absolutePath: string) => Promise<string>;

/** One indexed directory, where it really is, and the folder Claude Code names after that. */
export interface ResolvedDirectory {
  cwd: string;
  real: string;
  folder: string;
}

/** Folder name → directory, for the names exactly one checkout has. Spellings of one checkout (a link
 *  to it, the path itself) are one checkout: they share a real path. The directory named is the real
 *  path when the index has it, else the first spelling. Pure. */
export function uniqueByFolder(resolved: readonly ResolvedDirectory[]): Map<string, string> {
  const found = new Map<string, ResolvedDirectory[]>();
  resolved.forEach((entry) => found.set(entry.folder, [...(found.get(entry.folder) ?? []), entry]));
  return new Map(
    [...found].flatMap(([folder, entries]) => {
      if (new Set(entries.map((entry) => entry.real)).size !== 1) return [];
      const named = entries.find((entry) => entry.cwd === entry.real) ?? entries[0];
      return named === undefined ? [] : [[folder, named.cwd] as const];
    }),
  );
}

const held = new Map<string, { real: string; at_ms: number }>();

/** Where `cwd` really is (links resolved, the disk's case), or its absolute path when it cannot be
 *  resolved (gone, unreadable) — the name it had while it was there. */
async function realOf(cwd: string, realpath: RealPath, now_ms: number): Promise<string> {
  const kept = held.get(cwd);
  if (kept !== undefined && now_ms - kept.at_ms < REALPATH_MEMO_MS) return kept.real;
  const absolute = path.resolve(cwd);
  const real = await realpath(absolute).catch(() => absolute);
  held.set(cwd, { real, at_ms: now_ms });
  return real;
}

/** Each project folder name the index's directories have, mapped to its one directory. */
export async function directoriesByFolder(
  cwds: readonly string[],
  realpath: RealPath = nativeRealpath,
  now_ms: number = Date.now(),
): Promise<Map<string, string>> {
  const distinct = [...new Set(cwds)];
  const resolved: ResolvedDirectory[] = [];
  for (let start = 0; start < distinct.length; start += RESOLVE_AT_ONCE) {
    const batch = distinct.slice(start, start + RESOLVE_AT_ONCE);
    const reals = await Promise.all(batch.map((cwd) => realOf(cwd, realpath, now_ms)));
    reals.forEach((real, at) => resolved.push({ cwd: batch[at] ?? "", real, folder: encodeProjectDirName(real) }));
  }
  return uniqueByFolder(resolved);
}

/** Forget the resolved names, for tests. */
export const forgetResolvedFolders = (): void => held.clear();
