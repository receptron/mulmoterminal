// The name a user gave a codex session with `/rename`.
//
// It is not in the rollout. codex appends it to `$CODEX_HOME/session_index.jsonl`, one
// `{id, thread_name, updated_at}` per rename, and resolves a name by taking the LAST non-empty
// entry for an id (`find_thread_names_by_ids` in codex-rs/rollout/src/session_index.rs). Clearing
// a name is not an empty entry — codex rewrites the file without those lines — so this file is
// append-only nearly always and occasionally SHORTER than it was.
//
// Which is why the cache below re-folds the whole file rather than continuing from a byte offset:
// a rewrite makes an offset point into the middle of someone else's line, and the reward for
// getting that right is a file that is a few hundred bytes on every machine measured.
import { stat } from "node:fs/promises";
import path from "node:path";
import { forEachJsonlRecord } from "../infra/jsonl-file.js";

const SESSION_INDEX_FILE = "session_index.jsonl";

/** One rename, or null for any other line. Empty names are dropped here rather than stored: codex
 *  ignores them when resolving, so an entry carrying one must not shadow the name before it. */
export function parseThreadNameEntry(doc: Record<string, unknown>): { id: string; name: string } | null {
  const { id, thread_name: threadName } = doc;
  if (typeof id !== "string" || !id || typeof threadName !== "string") return null;
  const name = threadName.trim();
  return name ? { id, name } : null;
}

/** Fold one index line into the names so far. Later entries win, which is what makes a second
 *  `/rename` stick. The streamed read below and the array reader go through this one rule, so
 *  what a spec drives is what the server runs. */
export function foldThreadName(names: Map<string, string>, doc: Record<string, unknown>): void {
  const entry = parseThreadNameEntry(doc);
  if (entry) names.set(entry.id, entry.name);
}

/** The current name per thread id. Takes an ARRAY, so it is the shape a spec can drive. */
export function foldThreadNames(docs: readonly Record<string, unknown>[]): Map<string, string> {
  const names = new Map<string, string>();
  docs.forEach((doc) => foldThreadName(names, doc));
  return names;
}

/** codex's home from its sessions root. `codexSessionsRoot()` is the one place that builds the
 *  root, as `join(home, "sessions")`, so the parent IS the home — pinned by a spec next door. */
export const codexHomeOf = (sessionsRoot: string): string => path.dirname(sessionsRoot);

// Re-read only when the file itself changed. The listing this feeds is polled while a user is
// picking a session, and a rename is rare enough that almost every one of those requests can be
// answered by a single stat.
let cached: { file: string; size: number; mtime_ms: number; names: ReadonlyMap<string, string> } | null = null;

const EMPTY: ReadonlyMap<string, string> = new Map();

/** Every `/rename` codex has recorded, by thread id. Empty when the file is absent — a codex old
 *  enough not to write one, or a user who has never renamed anything. */
export async function readThreadNames(codexHome: string): Promise<ReadonlyMap<string, string>> {
  const file = path.join(codexHome, SESSION_INDEX_FILE);
  const stamp = await statOf(file);
  if (!stamp) {
    if (cached?.file === file) cached = null;
    return EMPTY;
  }
  if (cached && cached.file === file && cached.size === stamp.size && cached.mtime_ms === stamp.mtime_ms) return cached.names;
  const names = new Map<string, string>();
  try {
    await forEachJsonlRecord(file, (doc) => foldThreadName(names, doc));
  } catch {
    // Unreadable mid-scan: keep whatever the last complete read said rather than blanking every
    // renamed row until the next change to the file.
    return cached?.file === file ? cached.names : EMPTY;
  }
  cached = { file, ...stamp, names };
  return names;
}

/** Forgets the memoised index. For specs, which write a new one per temp directory. */
export const resetThreadNameCache = (): void => {
  cached = null;
};

async function statOf(file: string): Promise<{ size: number; mtime_ms: number } | null> {
  try {
    const { size, mtimeMs } = await stat(file);
    return { size, mtime_ms: mtimeMs };
  } catch {
    return null;
  }
}
