// Which notification a "sessions" activity push raises. Pure and separate from the player so
// the mapping is unit-testable without an AudioContext — and, because getting this wrong is
// heard as either silence or a storm, cross-checked against the server's real publish
// sequences in test/src/composables/notifyKindFromServer.spec.ts.

import type { NotifyKind } from "../../common/notifyKinds";

export interface ActivityMsg {
  id: string;
  working?: boolean;
  waiting?: boolean;
  // The hook that caused this push ("Stop", "Notification", "closed", a tool event…). Which
  // one it was is NOT recoverable from the flags: a background Stop raises the very same
  // `waiting` flag a permission prompt does (see server/session/activity-hook.ts), so
  // without this a finished turn and a blocked one are indistinguishable here.
  event?: string | null;
  // The session's working dir, so a beep can use that directory's own sound.
  cwd?: string | null;
  // On a teardown ("closed"): this was a hidden background worker that never completed a turn.
  // Carried on the same message rather than sent as its own, so the generic teardown
  // notification cannot arrive first — see notifyKindOf.
  failed?: boolean;
}

export interface ActivityState {
  working: boolean;
  waiting: boolean;
  // The event whose rows we are currently reading, and whether it has already been announced.
  // ONE hook can publish more than one row — a background Stop applies `waiting: true` and
  // then `working: false`, and each change publishes — so the rows have to be collapsed back
  // into the single moment they describe. Which of them arrives is not fixed: an unchanged
  // flag publishes nothing, so a Stop can produce either row, or only one of them.
  event: string | null;
  announced: boolean;
}

export const isActivityMsg = (d: unknown): d is ActivityMsg => typeof d === "object" && d !== null && "id" in d;

// What a row means on its own, before the once-per-event rule is applied.
//   finished — the turn ended: either the working flag dropped, or (with no working flag to
//              drop) a Stop raised the attention flag.
//   waiting  — the agent stopped to ask. The same attention flag, told apart by the event.
function rawKind(was: ActivityState, now: ActivityState, event: string | null): NotifyKind | null {
  const attentionRose = !was.waiting && now.waiting;
  if (event === "Stop") return attentionRose || (was.working && !now.working) ? "finished" : null;
  if (was.working && !now.working) return "finished";
  return attentionRose ? "waiting" : null;
}

/**
 * The notification this push raises, or null for none. First sight of a session is baseline
 * only. Mutates `prev` to the latest state.
 *
 * Reading the flags alone (as this did before #873) could not tell a finished turn from a
 * blocked one, and counted a background Stop's two rows as two separate beeps.
 */
export function notifyKindOf(prev: Map<string, ActivityState>, msg: ActivityMsg): NotifyKind | null {
  // The PTY was reaped: forget the session, so an id that comes back is a baseline again and
  // not compared against a state from its previous life.
  //
  // ONE teardown message carries both facts. `failed` marks a hidden worker that never completed
  // a turn, and it wins: it is the specific answer where session-exited is the generic one, and
  // two messages would let the generic beat it (Codex, #1188). It deliberately does NOT depend on
  // `prev` — a worker has no cell, so nothing here ever saw it working, and requiring a baseline
  // would drop the one notification that exists precisely because nobody was watching.
  if (msg.event === "closed") {
    const seen = prev.delete(msg.id);
    if (msg.failed) return "worker-failed";
    return seen ? "session-exited" : null;
  }
  const event = msg.event ?? null;
  const was = prev.get(msg.id);
  // A row carrying a different event starts a new moment, so it may be announced again. The
  // rows of ONE hook all carry that hook's name, which is what collapses them to a single beep.
  const announced = was?.event === event && (was?.announced ?? false);
  const now: ActivityState = { working: msg.working ?? false, waiting: msg.waiting ?? false, event, announced };
  prev.set(msg.id, now);
  if (!was) return null;
  const kind = announced ? null : rawKind(was, now, event);
  if (kind) now.announced = true;
  return kind;
}
