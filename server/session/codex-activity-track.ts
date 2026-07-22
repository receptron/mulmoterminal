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

function applyBoundary(sessionId: string, boundary: CodexTurnBoundary, deps: CodexActivityTrackDeps): void {
  const event = HOOK_EVENT_FOR[boundary];
  const { effects, push } = boundaryOutcome(boundary, deps.isActive());
  for (const eff of effects) {
    if (eff.kind === "working") deps.setWorking(sessionId, eff.value, event);
    else deps.setWaiting(sessionId, eff.value, event);
  }
  // `message` is empty: codex has no Notification equivalent, and a finished turn's body
  // comes from its reply, not from a hook payload.
  if (push) void notifyTaskFinished(sessionId, push, "", deps.uiPort);
}

// Start tailing; it stops on its own once the session is gone. `startAtEnd` skips a
// resumed rollout's history — replaying it would flag the cell from turns that finished
// days ago.
export function trackCodexActivity(sessionId: string, file: string, startAtEnd: boolean, deps: CodexActivityTrackDeps): void {
  watchCodexActivity({
    fileSize: sizeOf(file),
    readSlice: readSliceOf(file),
    onBoundary: (boundary) => applyBoundary(sessionId, boundary, deps),
    isAlive: deps.isAlive,
    startAtEnd,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }).catch(() => {}); // a rollout that vanishes mid-session just stops reporting
}
