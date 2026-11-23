// Directory presets the launch form offers, persisted at config.json. Extracted
// from index.ts so the sanitize/load/save logic is unit-testable.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { type CwdPreset } from "../config-schema.js";
import { readJsonFile } from "../../infra/fs/read-text-file.js";
import { writeFileAtomicSync } from "../../files/atomic-write.js";
import { isRecord } from "../../../common/isRecord.js";
import { isManagedWorktreePath } from "../../../common/worktreePath.js";
import { worktreesRootDir } from "../worktree/worktree-task.js";
import { canonicalPath } from "../../infra/fs/canonical-path.js";
import { canonicalDir } from "../../infra/fs/path-within.js";
const isPreset = (v: unknown): v is CwdPreset => isRecord(v) && typeof v.label === "string" && typeof v.path === "string";

// A preset's path in the one spelling the rest of the app uses. Trailing separators are what a
// shell's tab-completion leaves on a path the user pastes into the launch form, and they used to
// be stored verbatim — so once the server started reporting the canonical cwd back (#1002), the
// same directory would be recorded a SECOND time and show two chips.
//
// Absolute only: `path.resolve` would splice a relative entry onto the server's own cwd and
// invent a directory the user never named. A relative preset can't launch anyway (the workspace
// guard rejects it), so it is left exactly as written rather than silently repointed.
const presetPath = (raw: string): string => {
  const trimmed = raw.trim();
  return path.isAbsolute(trimmed) ? canonicalDir(trimmed) : trimmed;
};

// Normalize arbitrary input into clean presets: keep only {label,path} objects, trim, canonicalize
// the path, drop entries missing either field, collapse duplicates, and cap the count.
export function sanitizePresets(input: unknown, max = 50): CwdPreset[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .filter(isPreset)
    .map((p) => ({ label: p.label.trim(), path: presetPath(p.path) }))
    .filter((p) => p.label && p.path);
  // Deduped AFTER canonicalizing, keeping the first: the list is most-recently-used order, so the
  // survivor is the newer entry and its label (which the user may have renamed) is the one kept.
  const seen = new Set<string>();
  return cleaned
    .filter((p) => {
      if (seen.has(p.path)) return false;
      seen.add(p.path);
      return true;
    })
    .slice(0, max);
}

export function loadPresets(file: string): CwdPreset[] {
  try {
    if (!existsSync(file)) return [];
    const parsed: unknown = readJsonFile(file);
    return sanitizePresets(isRecord(parsed) ? parsed.cwdPresets : undefined);
  } catch {
    return [];
  }
}

const ABSENT_CODES = new Set(["ENOENT", "ENOTDIR"]);

// Only a definite "not there" counts: EACCES or an I/O error reads as present, because the caller
// deletes saved entries on this answer.
export function isAbsentDir(dir: string): boolean {
  try {
    statSync(dir);
    return false;
  } catch (err) {
    return isRecord(err) && typeof err.code === "string" && ABSENT_CODES.has(err.code);
  }
}

// Persist; returns false on any write failure so the caller can surface it
// instead of reporting a false success.
export function savePresets(file: string, presets: CwdPreset[]): boolean {
  try {
    writeFileAtomicSync(file, JSON.stringify({ cwdPresets: presets }, null, 2));
    return true;
  } catch {
    return false;
  }
}

// A working dir discovered from a Claude session, with the session's mtime for recency.
export interface CwdRecord {
  cwd: string;
  mtimeMs: number;
}

// The working directory a session ran in, read from its transcript. Claude records `cwd`
// on its JSONL lines — return the first one found. (The project-dir NAME can't be decoded:
// `/`, `.`, and a literal `-` all encode to `-`, so `my-app` would decode to `my/app`.)
export function extractCwdFromTranscript(raw: string): string | null {
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const entry: unknown = JSON.parse(line);
      const cwd = isRecord(entry) ? entry.cwd : undefined;
      if (typeof cwd === "string" && cwd) return cwd;
    } catch {
      // a partial / non-JSON line (e.g. a truncated head read) — keep scanning
    }
  }
  return null;
}

// Turn discovered session cwds into launch-form presets, newest first: drop dirs that no
// longer exist (via `exists`, so no bogus preset ever lands), drop managed worktrees (a task
// branch is not a place to launch in again — the same rule the browser records by, shared so the
// two cannot drift), dedupe by path keeping the newest mtime, then cap at `max`. Pure — `exists`
// and the worktree root are both injected — so the derivation rule is unit-testable.
// The default root is CANONICAL, like the one `worktree-env.ts` compares against: the cwds here
// come out of Claude's transcripts already realpathed, so a MULMOTERMINAL_HOME behind a symlink
// would never match a raw root and every worktree would seed as a preset again.
export function deriveCwdPresets(
  records: readonly CwdRecord[],
  exists: (dir: string) => boolean,
  max = 10,
  worktreesRoot: string | null = canonicalPath(worktreesRootDir()),
): CwdPreset[] {
  const newestByPath = new Map<string, number>();
  for (const { cwd, mtimeMs } of records) {
    if (!cwd || isManagedWorktreePath(cwd, worktreesRoot) || !exists(cwd)) continue;
    const prev = newestByPath.get(cwd);
    if (prev === undefined || mtimeMs > prev) newestByPath.set(cwd, mtimeMs);
  }
  return [...newestByPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([dir]) => ({ label: path.basename(dir) || dir, path: dir }));
}
