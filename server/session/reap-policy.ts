// Pure decision for "this session just went detached — reap it, and when?" (see
// armReapForDetached in index.ts). Split out so the ordering rule below is unit-testable.
//
// `waiting` is checked BEFORE `working` because Notification never clears `working`:
// a session blocked on a permission prompt stays working:true for as long as it sits
// there, so a working-first check would refuse to reap it forever — which is how
// scheduled background sessions (nobody there to answer) leaked tmux sessions (#541).

export interface ReapActivity {
  working?: boolean;
  waiting?: boolean;
}

export interface ReapGraces {
  /** Grace for a finished, already-seen session. */
  idleMs: number;
  /** Grace for one that needs the user — long enough to come back and answer. */
  waitingMs: number;
}

export type ReapDecision = { kind: "keep" } | { kind: "arm"; delayMs: number };

export function reapDecisionFor(activity: ReapActivity | undefined, graces: ReapGraces): ReapDecision {
  if (activity?.waiting) return { kind: "arm", delayMs: graces.waitingMs };
  if (activity?.working) return { kind: "keep" }; // clearly working, don't close it
  return { kind: "arm", delayMs: graces.idleMs };
}
