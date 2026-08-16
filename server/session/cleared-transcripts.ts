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

// What the prompts pane needs on top of "is this frozen": WHEN the clear happened, and WHICH id
// claude took for the conversation it started there (#1749). The set above is enough for its own
// readers, which all ask about the transcript FILE; claude's prompt history is one file per USER,
// with no seam at a clear, so separating the two conversations in it takes both facts.
//
// Here rather than in the registry, and written by markTranscriptCleared rather than by the route,
// so they cannot disagree: whatever marks a session cleared records when it happened and what
// claude became. They ride the same durable mark, so both survive the restart that the memory-only
// version lost them to — the second one because a pane that knows only the boundary shows NOTHING
// after a restart, having forgotten the id the new conversation's prompts are filed under (Codex).
const clearedState = new Map<string, ClearedState>(); // id -> { at, claudeId }

interface ClearedState {
  /** Epoch ms of the clear. */
  at: number;
  /** The id claude reported for itself in the very hook that announced the clear. */
  claudeId?: string | undefined;
}

/** When this session was cleared, or undefined for one that was not (or a mark written before the
 *  time was recorded — an older mark on disk, which reads as no boundary rather than a wrong one). */
export const clearedAtOf = (id: string): number | undefined => clearedState.get(id)?.at;

/** The id claude took at that clear, for a reader that has no fresher one (the live mapping is
 *  re-learned from any hook and wins where it exists). */
export const clearedClaudeIdOf = (id: string): string | undefined => clearedState.get(id)?.claudeId;

export interface ClearedMark {
  /** Where the frozen transcript lives, so hydration can stat it without the session's pty. */
  cwd: string;
  size: number;
  /** Epoch ms of the clear. Optional: marks written before #1749 have none. */
  at?: number;
  /** Claude's own session id from that moment. Optional for the same reason. */
  claudeId?: string;
}

/** A mark read back off disk, or null for anything that isn't one (corrupt / hand-edited file).
 *
 *  The two optional fields drop to absent rather than rejecting the mark: its job is to freeze the
 *  transcript, and losing that over a malformed extra would resurrect a whole conversation. */
export function parseClearedMark(raw: unknown): ClearedMark | null {
  if (!isRecord(raw)) return null;
  const { cwd, size, at, claudeId } = raw;
  if (typeof cwd !== "string" || !cwd || typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;
  const mark: ClearedMark = { cwd, size };
  if (typeof at === "number" && Number.isFinite(at) && at >= 0) mark.at = at;
  // Same shape check every other id crosses, because this one is read back from a file on disk and
  // then used to select rows out of claude's history.
  if (typeof claudeId === "string" && SESSION_ID_RE.test(claudeId)) mark.claudeId = claudeId;
  return mark;
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
 *  clear itself, which is the part the user is watching.
 *
 *  `claudeId` is what claude called ITSELF in the hook that announced this clear — the id the new
 *  conversation's prompts are filed under in its history. Undefined where the hook named none. */
export async function markTranscriptCleared(id: string, cwd: string | undefined, claudeId?: string, dir: string = CLEARED_DIR): Promise<void> {
  clearedTranscripts.add(id);
  // Before the early return: a session with no cwd is still cleared AT a moment, and the prompts
  // pane draws its line from that whether or not there is a file to freeze.
  const at = Date.now();
  clearedState.set(id, { at, claudeId });
  // No cwd (a hook that reported none, for a session with no live pty) means no file to size, and
  // a mark with nothing to compare against could never expire — so that one stays in memory only.
  if (!cwd || !SESSION_ID_RE.test(id)) return;
  const mark: ClearedMark = { cwd, size: await transcriptSize(cwd, id), at, ...(claudeId ? { claudeId } : {}) };
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
  clearedState.delete(id);
  void removeMarker(dir, id);
}

// `.catch` AFTER the parse, not a second argument to `.then`: an onRejected handler passed
// alongside onFulfilled does not see what onFulfilled threw, so a corrupt file would escape
// hydration as an unhandled SyntaxError rather than reading as "no mark".
const readMark = (dir: string, id: string): Promise<unknown> =>
  fs
    .readFile(markerFile(dir, id), "utf8")
    .then((text): unknown => JSON.parse(text))
    .catch(() => null);

async function restoreMark(dir: string, file: string): Promise<void> {
  const id = file.endsWith(".json") ? file.slice(0, -".json".length) : "";
  if (!SESSION_ID_RE.test(id)) return; // not ours / not a session id — leave it alone
  // Awaited, unlike reap's fire-and-forget drop: nothing else is waiting on boot, and a marker
  // left behind would be re-examined on every restart from here on.
  const mark = parseClearedMark(await readMark(dir, id));
  if (!mark || !markStillHolds(mark, await transcriptSize(mark.cwd, id))) return removeMarker(dir, id);
  clearedTranscripts.add(id);
  // Only when the mark carried a time: an older one freezes the transcript and draws no line, which
  // is what it meant when it was written.
  if (mark.at !== undefined) clearedState.set(id, { at: mark.at, claudeId: mark.claudeId });
}

/** Read the marks back at boot. Absent directory (first run) => nothing frozen.
 *
 *  Called from index.ts before the server listens — NOT at import. The readers are synchronous,
 *  so hydration has to be finished before the first hook can arrive; and because this discards
 *  marks it finds stale, an import-time run would reach into the real home from every spec that
 *  loads this module. */
export async function hydrateClearedTranscripts(dir: string = CLEARED_DIR): Promise<void> {
  const files = await fs.readdir(dir).catch((): string[] => []);
  await Promise.all(files.map((file) => restoreMark(dir, file)));
}
