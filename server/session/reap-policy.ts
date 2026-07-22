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

// ── the two numbers that decision produces, before they reach a timer ──────────

/** Node's setTimeout delay is a signed 32-bit int; a larger value overflows and fires at
 *  ~1ms, turning a long grace into an instant reap. */
export const MAX_TIMER_MS = 2_147_483_647;

/** How long to actually wait, or null for "never auto-reap". A non-positive grace is the
 *  documented way to switch auto-reaping off, and a non-finite one can only come from a
 *  bad config — both must mean "no timer" rather than setTimeout's ~immediate fire. */
export function reapTimerDelay(delayMs: number): number | null {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return null;
  return Math.min(delayMs, MAX_TIMER_MS);
}

/** The grace a detached-but-needed session gets, read from WAIT_REAP_GRACE_MS. Anything
 *  that isn't a number falls back to the default rather than disabling reaping by
 *  accident; a non-positive value is an explicit "never auto-close these". `onInvalid`
 *  reports the fallback so the caller can warn. */
export function parseWaitGraceMs(raw: string | undefined, defaultMs: number, onInvalid?: (raw: string) => void): number {
  if (raw === undefined) return defaultMs;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    onInvalid?.(raw);
    return defaultMs;
  }
  return n;
}

/** Whether teardown may also drop the session's activity record. A session that is still
 *  working or still waiting keeps it: `waiting` is the bold-until-viewed window, and the
 *  row has to stay bold after its pty is gone until the user actually looks. Only once
 *  neither holds is the record — and the hidden flag that rides with it — safe to drop. */
export function shouldForgetActivity(activity: ReapActivity | undefined): boolean {
  return !activity || (!activity.working && !activity.waiting);
}
