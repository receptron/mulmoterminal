// Which sessions' transcripts are frozen — and why that has to outlive this process.
//
// `/clear` makes claude mint a NEW session id and a new transcript, while hooks keep reporting
// under ours (hook-settings.ts), so from that moment `${id}.jsonl` holds the conversation the
// user just ended. Reading it is what put the pre-clear summary and reply back in the cockpit
// (#1085), so every reader of that file asks this set first.
//
// It is PERSISTED because the window it covers is longer than one process: tmux keeps the
// session's claude running across a server restart — which is what the activity state is
// persisted for too — and an in-memory mark would be gone while the frozen file is still exactly
// as frozen. The next turn would then re-read it and undo the fix (Codex).
//
// One file per id, holding the transcript's SIZE at the moment of the clear:
//   - per id, because the home is shared by every server rooted at it, and a read-merge-write
//     loses whichever of two instances finishes first (registry.ts says the same of its id logs).
//     An id belongs to one server, so per-id files never race.
//   - the size, because it is what lets a mark expire on its own. A later `--resume` appends to
//     that file, so a file bigger than the recorded size means claude is writing to it again and
//     the mark no longer describes anything. Without that, a server killed before reap would
//     leave a mark that silences a resumed session's summary for good.
import { promises as fs } from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../config/env.js";
import { isRecord } from "../../common/isRecord.js";
import { messageOf } from "../errors.js";
import { projectSessionsDir } from "./project-dir.js";

const CLEARED_DIR = path.join(MULMOTERMINAL_HOME, "cleared-transcripts");

// Read synchronously by the hot paths (a publish runs on every hook), so the durable copy is
// hydrated into it at import — before the server listens, which is what closes the window.
export const clearedTranscripts = new Set<string>(); // id

export interface ClearedMark {
  /** Where the frozen transcript lives, so hydration can stat it without the session's pty. */
  cwd: string;
  size: number;
}

/** A mark read back off disk, or null for anything that isn't one (corrupt / hand-edited file). */
export function parseClearedMark(raw: unknown): ClearedMark | null {
  if (!isRecord(raw)) return null;
  const { cwd, size } = raw;
  if (typeof cwd !== "string" || !cwd || typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;
  return { cwd, size };
}

/** Whether the transcript is still the frozen one. Anything appended since means claude picked
 *  that file back up (`--resume`), which is the one thing that un-freezes it. */
export function markStillHolds(mark: ClearedMark, currentSize: number): boolean {
  return currentSize <= mark.size;
}

const markerFile = (dir: string, id: string) => path.join(dir, `${id}.json`);

async function transcriptSize(cwd: string, id: string): Promise<number> {
  try {
    return (await fs.stat(path.join(projectSessionsDir(cwd), `${id}.jsonl`))).size;
  } catch {
    return 0; // no transcript on disk (a session cleared before its first turn was written)
  }
}

/** Mark a session's transcript frozen. Best-effort on disk: failing to persist must not stop the
 *  clear itself, which is the part the user is watching. */
export async function markTranscriptCleared(id: string, cwd: string | undefined, dir: string = CLEARED_DIR): Promise<void> {
  clearedTranscripts.add(id);
  // No cwd (a hook that reported none, for a session with no live pty) means no file to size, and
  // a mark with nothing to compare against could never expire — so that one stays in memory only.
  if (!cwd || !SESSION_ID_RE.test(id)) return;
  const mark: ClearedMark = { cwd, size: await transcriptSize(cwd, id) };
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(markerFile(dir, id), JSON.stringify(mark));
  } catch (e) {
    console.error(`[cleared-transcripts] failed to persist ${id}: ${messageOf(e)}`);
  }
}

const removeMarker = (dir: string, id: string): Promise<void> =>
  fs.rm(markerFile(dir, id), { force: true }).catch((e) => console.error(`[cleared-transcripts] failed to drop ${id}: ${messageOf(e)}`));

/** Drop the mark, on disk too. The removal is fire-and-forget because the caller (reap) is
 *  synchronous; a file that outlives the process is caught by hydration either way. */
export function forgetClearedTranscript(id: string, dir: string = CLEARED_DIR): void {
  clearedTranscripts.delete(id);
  void removeMarker(dir, id);
}

// `.catch` AFTER the parse, not a second argument to `.then`: an onRejected handler passed
// alongside onFulfilled does not see what onFulfilled threw, so a corrupt file would escape
// hydration as an unhandled SyntaxError rather than reading as "no mark".
const readMark = (dir: string, id: string): Promise<unknown> =>
  fs
    .readFile(markerFile(dir, id), "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => null);

async function restoreMark(dir: string, file: string): Promise<void> {
  const id = file.endsWith(".json") ? file.slice(0, -".json".length) : "";
  if (!SESSION_ID_RE.test(id)) return; // not ours / not a session id — leave it alone
  // Awaited, unlike reap's fire-and-forget drop: nothing else is waiting on boot, and a marker
  // left behind would be re-examined on every restart from here on.
  const mark = parseClearedMark(await readMark(dir, id));
  if (!mark || !markStillHolds(mark, await transcriptSize(mark.cwd, id))) return removeMarker(dir, id);
  clearedTranscripts.add(id);
}

/** Read the marks back at boot. Absent directory (first run) => nothing frozen.
 *
 *  Called from index.ts before the server listens — NOT at import. The readers are synchronous,
 *  so hydration has to be finished before the first hook can arrive; and because this discards
 *  marks it finds stale, an import-time run would reach into the real home from every spec that
 *  loads this module. */
export async function hydrateClearedTranscripts(dir: string = CLEARED_DIR): Promise<void> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(files.map((file) => restoreMark(dir, file)));
}
