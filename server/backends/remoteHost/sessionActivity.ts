// Publishes a session's activity to Firestore so the phone can react to it (#439).
//
// The phone's terminal viewer can only poll today: the host writes exactly two things
// to Firestore — the presence doc and command docs — and neither carries per-session
// state. The presence doc is rebuilt inside @mulmoclaude/core and fully overwritten
// every heartbeat, so it cannot be extended from here. This adds a per-session doc
// instead, under the path the existing `users/{uid}/hosts/{document=**}` rule already
// covers, so no rules change and no core release are involved.
//
// Deliberately fire-and-forget: the caller sits on the synchronous hook path that
// serves Claude Code's own requests, and a Firestore hiccup must never disturb it.
import { deleteDoc, doc, serverTimestamp, setDoc, type DocumentReference, type Firestore } from "firebase/firestore";
import type { WorkPhase } from "../../session/workPhase.js";

export interface SessionActivity {
  working: boolean;
  waiting: boolean;
  // The two fields the phone needs to speak the same status vocabulary as the cockpit roster
  // (#727): `event` splits a `waiting` session into blocked (Notification) vs done (Stop), and
  // `workPhase` splits a `working` one into planning vs editing. Optional so a host that hasn't
  // observed them yet simply omits them and the reader degrades to working/waiting.
  event?: string | null;
  workPhase?: WorkPhase | null;
}

// `rev` is monotonic per session so a watcher can distinguish "changed again" from a
// re-delivered snapshot; `at` dates it for staleness checks.
export interface SessionActivityDoc extends SessionActivity {
  rev: number;
  at: unknown;
}

// Split from the publisher so tests can record writes without a Firestore.
export interface SessionActivityStore {
  write: (uid: string, hostId: string, sessionId: string, payload: SessionActivityDoc) => Promise<void>;
  remove: (uid: string, hostId: string, sessionId: string) => Promise<void>;
}

// Segments spelled out rather than spread: doc()'s overloads can't tell a string[]
// from a (reference, ...segments) call, and resolve to the wrong one.
const sessionDoc = (firestore: Firestore, uid: string, hostId: string, sessionId: string): DocumentReference =>
  doc(firestore, "users", uid, "hosts", hostId, "sessions", sessionId);

export const firestoreSessionActivityStore = (firestore: () => Firestore): SessionActivityStore => ({
  write: (uid, hostId, sessionId, payload) => setDoc(sessionDoc(firestore(), uid, hostId, sessionId), payload),
  remove: (uid, hostId, sessionId) => deleteDoc(sessionDoc(firestore(), uid, hostId, sessionId)),
});

export interface SessionActivityPublisherDeps {
  // Null while the remote host is disconnected. A non-null uid implies the session
  // handles exist, which is what makes the store's currentFirestore() safe to call —
  // that accessor THROWS when disconnected, unlike this one.
  uid: () => string | null;
  hostId: string;
  store: SessionActivityStore;
  onError: (error: unknown) => void;
}

export function createSessionActivityPublisher(deps: SessionActivityPublisherDeps) {
  const revisions = new Map<string, number>();
  const published = new Map<string, string>();
  // Every field the phone renders belongs in the key: a turn that moves planning → implementing,
  // or a waiting one that changes from blocked to done, keeps the same working/waiting pair and
  // would otherwise be deduped away — leaving the phone showing the superseded status (#727).
  const stateKey = ({ working, waiting, event, workPhase }: SessionActivity): string => `${working}:${waiting}:${event ?? ""}:${workPhase ?? ""}`;

  // Not every caller of the host's publishActivity is a state transition — generating
  // an AI title or clearing the header republishes an unchanged working/waiting pair.
  // Those must not bill a write, nor wake a watching phone into refetching a screen
  // that did not change.
  const publish = (sessionId: string, activity: SessionActivity): void => {
    const uid = deps.uid();
    if (!uid) return;
    const key = stateKey(activity);
    if (published.get(sessionId) === key) return;
    published.set(sessionId, key);
    const rev = (revisions.get(sessionId) ?? 0) + 1;
    revisions.set(sessionId, rev);
    deps.store.write(uid, deps.hostId, sessionId, { ...activity, rev, at: serverTimestamp() }).catch((error: unknown) => {
      // The dedup entry is recorded optimistically, so a failed write would otherwise
      // swallow every later publish of the SAME state and leave the phone stale until
      // some different transition happened. Release it so the next one retries —
      // unless a newer state has already superseded this one, which is then the
      // truth worth keeping. `rev` deliberately still advances: a gap only tells a
      // watcher a write was lost, which is exactly what happened.
      if (published.get(sessionId) === key) published.delete(sessionId);
      deps.onError(error);
    });
  };

  // On teardown, so the phone's picker doesn't accumulate docs for dead sessions. The
  // local bookkeeping is dropped even when disconnected — a session that comes back
  // under the same id starts from a clean slate rather than inheriting a stale key.
  const forget = (sessionId: string): void => {
    revisions.delete(sessionId);
    published.delete(sessionId);
    const uid = deps.uid();
    if (!uid) return;
    deps.store.remove(uid, deps.hostId, sessionId).catch(deps.onError);
  };

  return { publish, forget };
}
