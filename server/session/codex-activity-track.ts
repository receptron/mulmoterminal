// Wiring a codex session's rollout tail to its activity flags: the filesystem side of
// codex-activity-watch, plus the translation from a turn boundary to the same effects
// claude's hooks produce. Kept out of the spawner so starting a PTY stays about starting
// a PTY.

import { promises as fs } from "node:fs";
import { HOOK_EVENT_FOR, boundaryOutcome, type CodexTurnBoundary } from "../agents/codex-activity.js";
import { notifyTaskFinished } from "./task-push.js";
import { watchCodexActivity } from "./codex-activity-watch.js";

export interface CodexActivityTrackDeps {
  setWorking: (id: string, working: boolean, event?: string) => void;
  setWaiting: (id: string, waiting: boolean, event?: string) => void;
  /** Is this session the user's actively-viewed pane? Suppresses the attention flag. */
  isActive: () => boolean;
  /** Tell an open prompts pane that this session's list just grew. Codex reaches it from a turn
   *  START, which is the closest thing its rollout reports to "the user typed something"
   *  (common/promptChannel.ts). */
  publishPromptSubmitted: (sessionId: string) => void;
  /** Which port this host's UI answers on, so a notification can open it. */
  uiPort: string;
  /** False once THIS pty is gone. Must identify the pty, not just its session id: a
   *  session reaped and respawned under the same id within one poll would otherwise
   *  leave this tail running beside the new one, reporting every boundary twice. */
  isAlive: () => boolean;
}

const readSliceOf =
  (file: string) =>
  async (from: number, to: number): Promise<string> => {
    const handle = await fs.open(file, "r");
    try {
      const buf = Buffer.alloc(to - from);
      const { bytesRead } = await handle.read(buf, 0, buf.length, from);
      return buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  };

const sizeOf = (file: string) => async (): Promise<number | null> => {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return null; // not written yet, or removed under us
  }
};

/** What one turn boundary does. Exported for its spec: the tail loop around it needs a real file
 *  and a poll interval, and what has actually broken twice is this — which side effects fire on
 *  which boundary — not the tailing. */
export function applyBoundary(sessionId: string, boundary: CodexTurnBoundary, deps: CodexActivityTrackDeps): void {
  const event = HOOK_EVENT_FOR[boundary];
  // BOTH boundaries, and not derived from the effects below: a `setWorking` that does not move the
  // flag publishes nothing, so reading the pane's signal off the activity row loses the prompt that
  // starts a turn while one is already open (#1749).
  //
  // Both, because when codex flushes the `user_message` its rollout carries is not something this
  // repo has measured — last-turn.ts says it writes "lazily" and skips an in-flight turn on that
  // basis. If that is right, only `completed` finds the prompt and the start publish is a wasted
  // reload; if it is wrong, `started` shows it immediately and `completed` refreshes a list that is
  // already correct. One of them is redundant and neither is harmful, which is the shape to pick
  // when the premise cannot be checked cheaply — the pane is debounced, so a turn costs one extra
  // read of a file it was going to read anyway (Codex).
  deps.publishPromptSubmitted(sessionId);
  const { effects, push } = boundaryOutcome(boundary, deps.isActive());
  for (const eff of effects) {
    if (eff.kind === "working") deps.setWorking(sessionId, eff.value, event);
    else deps.setWaiting(sessionId, eff.value, event);
  }
  // Nothing to hand over: codex has no Notification equivalent, and no hook that could carry a
  // finished turn's reply — that one is read back out of the rollout.
  if (push) void notifyTaskFinished(sessionId, push, { message: "" }, deps.uiPort);
}

// Start tailing; it stops on its own once the session is gone. `startAtEnd` skips a
// resumed rollout's history — replaying it would flag the cell from turns that finished
// days ago. `restoreOpenTurn` is the reattach exception to that skip: a turn the file
// leaves OPEN is what the surviving process is doing right now (see CodexActivityDeps).
export function trackCodexActivity(
  sessionId: string,
  file: string,
  mode: { startAtEnd: boolean; restoreOpenTurn?: boolean },
  deps: CodexActivityTrackDeps,
): void {
  watchCodexActivity({
    fileSize: sizeOf(file),
    readSlice: readSliceOf(file),
    onBoundary: (boundary) => applyBoundary(sessionId, boundary, deps),
    isAlive: deps.isAlive,
    startAtEnd: mode.startAtEnd,
    restoreOpenTurn: mode.restoreOpenTurn ?? false,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }).catch(() => {}); // a rollout that vanishes mid-session just stops reporting
}
