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

/** Folder name → directory, for the names exactly one distinct directory has. Pure. */
export function uniqueByFolder(pairs: ReadonlyArray<readonly [folder: string, cwd: string]>): Map<string, string> {
  const found = new Map<string, Set<string>>();
  pairs.forEach(([folder, cwd]) => found.set(folder, (found.get(folder) ?? new Set()).add(cwd)));
  return new Map([...found].flatMap(([folder, dirs]) => (dirs.size === 1 ? [[folder, [...dirs][0] ?? ""] as const] : [])));
}

const held = new Map<string, { folder: string; at_ms: number }>();

/** `cwd`'s folder name as Claude Code makes it: its real path encoded, or its absolute path when it
 *  cannot be resolved (gone, unreadable) — the name it had while it was there. */
async function folderOf(cwd: string, realpath: RealPath, now_ms: number): Promise<string> {
  const kept = held.get(cwd);
  if (kept !== undefined && now_ms - kept.at_ms < REALPATH_MEMO_MS) return kept.folder;
  const absolute = path.resolve(cwd);
  const folder = encodeProjectDirName(await realpath(absolute).catch(() => absolute));
  held.set(cwd, { folder, at_ms: now_ms });
  return folder;
}

/** Each project folder name the index's directories have, mapped to its one directory. */
export async function directoriesByFolder(
  cwds: readonly string[],
  realpath: RealPath = nativeRealpath,
  now_ms: number = Date.now(),
): Promise<Map<string, string>> {
  const distinct = [...new Set(cwds)];
  const pairs: Array<readonly [string, string]> = [];
  for (let start = 0; start < distinct.length; start += RESOLVE_AT_ONCE) {
    const batch = distinct.slice(start, start + RESOLVE_AT_ONCE);
    const folders = await Promise.all(batch.map((cwd) => folderOf(cwd, realpath, now_ms)));
    folders.forEach((folder, at) => pairs.push([folder, batch[at] ?? ""]));
  }
  return uniqueByFolder(pairs);
}

/** Forget the resolved names, for tests. */
export const forgetResolvedFolders = (): void => held.clear();
