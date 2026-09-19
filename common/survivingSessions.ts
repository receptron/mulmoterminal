// A session that outlived the server, as Settings lists it (#1478).
//
// tmux persistence means a session survives a restart, and until now the app could only show one
// you happened to be looking at: the launcher's rows are per directory and per agent (#1474), so a
// project you no longer open — and a Shell session, which has no conversation to list at all — were
// visible nowhere. This is the row that makes them visible, and endable.
//
// In `common/` because both sides decide from it: the server fills it from tmux plus its own
// registry (session/surviving-sessions.ts), and the section renders and acts on it
// (components/settings/SurvivingSessionsSection.vue).
import type { TerminalAgent } from "./sessionAgent.js";

export interface SurvivingSession {
  /** The tmux session key — what `POST /api/session/:id/terminate` takes. */
  key: string;
  /** Where it runs: the live pty's own directory, else the one remembered for it. Null when this
   *  server has never seen it — a session from an older build, or one started by hand. */
  cwd: string | null;
  /** What is running in it, when that can be known: the live pty's agent, else whichever agent's
   *  store holds a conversation under this key. Null is meaningful — it is what a Shell or a
   *  launcher command looks like, and those are the ones nothing else in the app lists. */
  agent: TerminalAgent | null;
  /** Seconds since tmux last saw activity in it, or null when tmux could not say. The number that
   *  separates "working while I was away" from "abandoned three days ago". */
  idleSeconds: number | null;
  /** A terminal is holding it — this window, another tab, or a second MulmoTerminal. */
  attached: boolean;
  /** Ending it does not lose the conversation: a transcript (or a rollout) can bring it back. False
   *  means the session IS the only copy — a Shell's scrollback, say.
   *
   *  On-disk evidence ONLY. Being live, or having once been a grid cell, restores nothing — and
   *  counting those is why this column claimed 20 of 22 sessions were restorable when 15 were. */
  resumable: boolean;
  /** The next sweep will end it: nothing is using it and it has been silent past
   *  `sessionIdleReapDays` (#1467). Said on the row so the sweep is visible in the list it acts on,
   *  rather than being noticed after the fact. */
  reapable: boolean;
}

/**
 * Clearing order: what can be cleared first, and among those the one sitting longest.
 *
 * An attached row cannot be stopped from here at all (it belongs to the terminal holding it), so it
 * sinks to the bottom — present for context, never in the way. `null` idle sorts last within its
 * group: tmux declining to answer is not evidence of age.
 */
export function byClearability(a: SurvivingSession, b: SurvivingSession): number {
  if (a.attached !== b.attached) return Number(a.attached) - Number(b.attached);
  return (b.idleSeconds ?? -1) - (a.idleSeconds ?? -1);
}
