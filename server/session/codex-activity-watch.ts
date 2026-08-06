// Tail a live codex session's rollout and report each turn boundary it appends.
//
// Polling, not fs.watch: the rollout lives under the user's profile, and on Windows a
// watch opened on an 8.3 short path makes libuv abort() the whole process — uncatchable
// by try/catch, on("error"), or uncaughtException. codex flushes each record immediately
// (measured at 0.5 ms), so a one-second poll costs a negligible amount of detection lag
// and none of that risk.
//
// Every dependency is injected so the loop can be driven with fakes: the real one reads
// the filesystem and mutates session flags, neither of which a test should need.

import { nextReadRange, takeCompleteLines, turnBoundaries, explicitWorkdirs, type CodexTurnBoundary } from "../agents/codex-activity.js";

export const CODEX_ACTIVITY_POLL_MS = 1000;
const RESUME_TAIL_BYTES = 4 * 1024 * 1024;

export interface CodexActivityDeps {
  /** Byte length of the rollout, or null while it doesn't exist yet. */
  fileSize: () => Promise<number | null>;
  /** The rollout's bytes in [from, to). */
  readSlice: (from: number, to: number) => Promise<string>;
  onBoundary: (boundary: CodexTurnBoundary) => void;
  onInitialBoundary?: (boundary: CodexTurnBoundary) => void;
  onCwd?: (cwd: string) => void;
  /** False once the session's pty is gone — the loop stops on the next tick. */
  isAlive: () => boolean;
  /** Resume only: skip what the rollout already holds. A fresh session starts at 0 so its
   *  first turn isn't missed; a resumed one would otherwise REPLAY every past turn and
   *  leave the cell flagged from history rather than from what is happening now. */
  startAtEnd: boolean;
  sleep: (ms: number) => Promise<void>;
}

export async function watchCodexActivity(deps: CodexActivityDeps): Promise<void> {
  let offset = deps.startAtEnd ? await startingOffset(deps) : 0;
  let pending = "";
  while (deps.isAlive()) {
    await deps.sleep(CODEX_ACTIVITY_POLL_MS);
    if (!deps.isAlive()) return;
    const size = await deps.fileSize();
    if (size === null) continue; // rollout not written yet (codex creates it on the first turn)
    const range = nextReadRange(offset, size);
    if (!range) continue;
    if (range.from === 0 && offset > 0) pending = ""; // the file restarted — the fragment is stale
    const taken = takeCompleteLines(pending, await deps.readSlice(range.from, range.to));
    pending = taken.pending;
    offset = range.to;
    explicitWorkdirs(taken.lines).forEach((cwd) => deps.onCwd?.(cwd));
    turnBoundaries(taken.lines).forEach(deps.onBoundary);
  }
}

// A rollout that doesn't exist yet has no history to skip, so a resume that beat codex to
// the file still starts from 0 and sees its first turn.
const startingOffset = async (deps: CodexActivityDeps): Promise<number> => {
  const size = await deps.fileSize();
  if (size === null) return 0;
  const from = Math.max(0, size - RESUME_TAIL_BYTES);
  const tail = await deps.readSlice(from, size);
  const taken = takeCompleteLines("", tail);
  const lines = (from > 0 ? taken.lines.slice(1) : taken.lines).concat(taken.pending ? [taken.pending] : []);
  const cwds = explicitWorkdirs(lines);
  const latestCwd = cwds.at(-1);
  if (latestCwd) deps.onCwd?.(latestCwd);
  const boundaries = turnBoundaries(lines);
  const latestBoundary = boundaries.at(-1);
  if (latestBoundary) deps.onInitialBoundary?.(latestBoundary);
  return size;
};
