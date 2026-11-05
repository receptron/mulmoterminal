// What a dead pty means (#1496).
//
// Under tmux our pty is the tmux CLIENT, not the agent — so a pty that exits says one of two very
// different things, and the exit handlers used to read both as the same one:
//
//   - the program inside ended, and tmux closed the session with it   → tear the session down
//   - something killed our client while the session kept running      → keep it, drop the client
//
// The second is not hypothetical: `[pty] claude exited code=0 signal=9` is a SIGKILL, and nothing
// here sends one (node-pty's `kill()` sends SIGHUP), so it came from outside — macOS ending a
// process under memory pressure, in the reported case. Reaping there kills a tmux session with a
// live agent in it, and forgets the title, which is what drops the row from the phone's list.
import { markSessionPlaced, ptys } from "../registry.js";
import { shouldCloseEndedCell } from "../../../common/endedCellClose.js";
import { worktreeLabel } from "../../../common/worktreePath.js";
import os from "node:os";
import { tmuxHasSession, tmuxTakePaneExitRecord } from "../../infra/process/tmux.js";
import { parsePaneExitRecord } from "../../infra/process/tmux-pane-exit.js";
import { sendExitAndClose, type PtyExitReport } from "../ws-frames.js";
import type { PtyEntry } from "../types.js";

/** What the pty's death is evidence of. */
export type PtyExitDisposition = "reap" | "keep" | "gone";

/**
 * Pure, because it is the whole decision: which of the two events just happened.
 *
 * `gone` is the third case and not an edge one — an explicit close reaps the session and only then
 * does the pty die, so the exit arrives with nothing left to act on.
 */
export function ptyExitDisposition(facts: { stillRegistered: boolean; tmuxBacked: boolean; tmuxAlive: boolean }): PtyExitDisposition {
  if (!facts.stillRegistered) return "gone";
  return facts.tmuxBacked && facts.tmuxAlive ? "keep" : "reap";
}

/** Whether the cell is told its SESSION ended. A `reap` is the agent ending on its own; a `gone` is
 *  usually a restart replacing the pty (the cell must stay), unless the close route asked for the
 *  session to end and its cell to go (#3067). */
export const sessionEndedForCell = (disposition: PtyExitDisposition, closeRequested: boolean): boolean =>
  disposition === "reap" || (disposition === "gone" && closeRequested);

/** Whether `entry` is still the pty registered under this id. An explicit close or a restart (#1918)
 *  removes it first and may register a replacement under the SAME id before the old process's exit
 *  arrives, so an exit handler that acted by id alone would end or forget the new session. */
export function isCurrentPty(sessionId: string, entry: PtyEntry): boolean {
  return ptys.get(sessionId) === entry;
}

/** Read the facts for this pty and decide. Separate from applying it, because the browser has to be
 *  told the outcome in the exit frame, and the frame must go out before the reap tears down. */
function decidePtyExit(sessionId: string, exiting: PtyEntry): PtyExitDisposition {
  const tmuxBacked = !!exiting.tmux;
  return ptyExitDisposition({
    stillRegistered: isCurrentPty(sessionId, exiting),
    tmuxBacked,
    // Asked only when it can matter: a non-tmux pty has nothing that could outlive it, and this
    // shells out.
    tmuxAlive: tmuxBacked && tmuxHasSession(sessionId),
  });
}

/**
 * Apply that decision. `reap` is passed in rather than imported because it belongs to the lifecycle
 * the spawners already receive it from — and because it is the half that must NOT run for a session
 * that is still alive.
 */
function applyPtyExit(sessionId: string, disposition: PtyExitDisposition, reap: (id: string) => void): void {
  if (disposition === "keep") {
    // The entry has to go even though the session stays: `ptys.has()` is what every reconnect path
    // reads as "there is a live pty here", and a dead one left in the table would be reused instead
    // of reattached.
    ptys.delete(sessionId);
    // NOT forgetAnsweredQuestion here: this is the branch where the SESSION survives (tmux is still
    // running, a reattach makes a new pty for it), so the dialog on screen is the same one and the
    // claim that stops a duplicate answer must outlive the client that died. The reap path — which
    // is where the session itself ends — drops it.
    console.log(`[pty] ${sessionId} lost its client, but its tmux session is still running — keeping it (reattaches on the next connect)`);
  } else if (disposition === "reap") {
    reap(sessionId);
  }
}

const SIGNAL_NUMBERS: ReadonlyMap<string, number> = new Map(Object.entries(os.constants.signals));

/** The program's own exit code when tmux recorded one (#3272), else the client's. Asked only on a
 *  reap: a `keep` is a session still running, and a `gone` was ended by us, not by the program. */
function programExitCode(sessionId: string, entry: PtyEntry, disposition: PtyExitDisposition, clientExitCode: number): number {
  if (disposition !== "reap" || !entry.tmux) return clientExitCode;
  const record = tmuxTakePaneExitRecord(sessionId);
  const recorded = record === null ? null : parsePaneExitRecord(record, SIGNAL_NUMBERS);
  if (recorded === null) return clientExitCode;
  if (recorded !== 0) console.log(`[pty] ${sessionId} program exited ${recorded} (recorded by tmux as ${record}) — keeping its cell`);
  return recorded;
}

/** A persistent pty's exit, end to end: decide, tell the browser whether the SESSION ended (only a
 *  reap means that — a `keep` is a lost client, and a cell closing on it would drop a live agent),
 *  then apply. `entry.ws` is read here, at exit time, because a reattach can swap it. */
export function reportPtyExit(
  sessionId: string,
  entry: PtyEntry,
  exit: Omit<PtyExitReport, "ended" | "reattached">,
  reap: (id: string) => void,
): PtyExitDisposition {
  const disposition = decidePtyExit(sessionId, entry);
  const exitCode = programExitCode(sessionId, entry, disposition, exit.exitCode);
  const reattached = !!entry.reattached;
  const sessionEnded = sessionEndedForCell(disposition, !!entry.closeRequested);
  sendExitAndClose(entry.ws, { ...exit, exitCode, reattached, ended: sessionEnded });
  // The cell nobody opened yet (an agent's spawnBackgroundChat with no grid on screen) gets the
  // same answer an open one would: if that cell would have closed itself, no grid should adopt the
  // session later and resume it as a new cell (#3055).
  const worktreeCell = worktreeLabel(entry.cwd) !== null;
  // A shell's code is its last command's, not a crash, so a launcher or bot job is decided as before.
  const closeExitCode = entry.agent === "shell" ? null : exitCode;
  if (shouldCloseEndedCell({ sessionEnded, lifetimeMs: exit.lifetimeMs, reattached, worktreeCell, exitCode: closeExitCode })) markSessionPlaced(sessionId);
  applyPtyExit(sessionId, disposition, reap);
  return disposition;
}
