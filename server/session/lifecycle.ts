// When a session dies, and who is told about its state.
//
// The last stateful thing index.ts owned. The DECISIONS inside were extracted and tested
// earlier (#548): reapDecisionFor picks the grace window, shouldForgetActivity decides what
// survives a teardown, nextActivity folds a flag change. What was left is the part that holds
// timers and calls them in the right order — which is exactly the part that could not be
// reached without booting the server.
//
// Three things arrive as deps rather than imports, for the same reason each did in index.ts:
//
//   publish — pub/sub only exists once the HTTP server does, and this is built before it.
//   forgetTitle — the title manager needs publishActivity, and reap needs forgetTitle. The
//     cycle is real; binding it late is how index.ts already broke it.
//   sessionActivityPublisher — the phone mirror, which needs Firestore credentials.
//
// Everything else is the shared session registry, which is imported directly.
import {
  activity,
  aiTitles,
  hiddenSessions,
  knownSessions,
  lastPrompts,
  lastResponses,
  lastTitleAttemptMs,
  lastTitledUserTurns,
  launchChoices,
  persistActivityState,
  ptys,
  titleInFlight,
} from "./registry.js";
import { parseWaitGraceMs, reapDecisionFor, reapTimerDelay, shouldForgetActivity } from "./reap-policy.js";
import { nextActivity, sessionRow, shouldRefreshReply } from "./activity-transition.js";
import { readLatestResponse } from "./session-reads.js";
import { cleanupSessionSettings } from "./session-settings.js";
import { cleanupSandbox } from "../infra/sandbox.js";
import { tmuxKillSession } from "../infra/tmux.js";

// The channel every session row is published on.
export const SESSIONS_CHANNEL = "sessions";

export interface SessionLifecycleDeps {
  /** Fan a row out to subscribers; a no-op before pub/sub exists. */
  publish: (channel: string, data: unknown) => void;
  /** Drop a session's AI title so the next turn regenerates it. */
  forgetTitle: (id: string) => void;
  /** Mirror of working/waiting for the phone's viewer. */
  sessionActivityPublisher: { publish: (id: string, state: { working: boolean; waiting: boolean }) => void; forget: (id: string) => void };
}

// Timers live per process, not per factory call — there is one server.
const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();

function refreshLastResponse(id: string, cwd: string): void {
  const text = readLatestResponse(id, cwd);
  if (text) lastResponses.set(id, text); // a failed read leaves any prior value
}

// On disconnect we don't kill an idle session immediately — a page reload is a
// brief disconnect, and reaping then would throw away a perfectly good live
// terminal (and its scrollback). Instead we keep the pty for a grace window; a
// reattach within it cancels the reap, so a reload just re-attaches to the same
// running terminal. Only after the window with no reattach do we reap.
const REAP_GRACE_MS = 30_000;
// A detached session that still needs the user — mid-turn output the user hasn't
// seen, or blocked on a permission/question prompt (the `waiting` flag) — is an
// unfinished task: reaping it loses work. So it gets a much longer grace than an
// idle one, long enough that you can switch away, do other things, and come back
// to answer it. Override with WAIT_REAP_GRACE_MS=0 to never auto-close these.
const WAIT_REAP_GRACE_DEFAULT_MS = 30 * 60_000;
const WAIT_REAP_GRACE_MS = parseWaitGraceMs(process.env.WAIT_REAP_GRACE_MS, WAIT_REAP_GRACE_DEFAULT_MS, (raw) =>
  console.warn(`[pty] ignoring non-numeric WAIT_REAP_GRACE_MS=${JSON.stringify(raw)}; using default ${WAIT_REAP_GRACE_DEFAULT_MS}ms`),
);

function cancelReap(id: string) {
  const t = reapTimers.get(id);
  if (t) {
    clearTimeout(t);
    reapTimers.delete(id);
  }
}

function scheduleReap(deps: SessionLifecycleDeps, id: string, delayMs: number = REAP_GRACE_MS) {
  // null => never auto-reap; the session stays until reattached or explicitly
  // terminated (see reapTimerDelay for why a bad value must not reach setTimeout).
  const delay = reapTimerDelay(delayMs);
  if (delay === null) return;
  if (reapTimers.has(id)) return;
  reapTimers.set(
    id,
    setTimeout(() => {
      reapTimers.delete(id);
      const entry = ptys.get(id);
      if (entry && !entry.ws) reap(deps, id); // still detached after the grace window
    }, delay),
  );
}

// Decide whether/when to reap a detached session based on its activity. A session
// that's actively thinking (`working`) is never reaped — that's "clearly working,
// don't close it". One that needs the user (`waiting`) gets the long grace. A
// genuinely idle session (finished AND already viewed, so neither flag) gets the
// short grace — that's the "auto-close inactive ones" behaviour. The ordering rule
// lives in reapDecisionFor (pure/tested).
function armReapForDetached(deps: SessionLifecycleDeps, id: string) {
  const entry = ptys.get(id);
  if (!entry || entry.ws) return; // still attached: nothing to reap
  // Recompute from scratch: state may have escalated (idle -> waiting) since the
  // last arm, and a stale short timer must not survive to reap a session that now
  // needs the user. cancelReap clears it so scheduleReap re-arms with the right grace.
  cancelReap(id);
  const decision = reapDecisionFor(activity.get(id), { idleMs: REAP_GRACE_MS, waitingMs: WAIT_REAP_GRACE_MS });
  if (decision.kind === "keep") {
    console.log(`[pty] keeping working session ${id} alive (detached)`);
    return;
  }
  scheduleReap(deps, id, decision.delayMs);
}

function reap(deps: SessionLifecycleDeps, id: string) {
  cancelReap(id);
  const entry = ptys.get(id);
  if (!entry) return; // already reaped
  ptys.delete(id);
  // An unpersisted new session vanishes with its pty; a persisted one stays
  // visible via its on-disk record.
  knownSessions.delete(id);
  launchChoices.delete(id); // the picked backend dies with the session that used it
  lastPrompts.delete(id); // don't leak prompt text for torn-down sessions
  lastResponses.delete(id); // ditto, and keep this map from growing across closed sessions
  deps.forgetTitle(id);
  deps.sessionActivityPublisher.forget(id); // drop the phone's copy so its picker has no ghosts
  titleInFlight.delete(id);
  lastTitledUserTurns.delete(id); // teardown only — kept across /clear as the re-title baseline
  lastTitleAttemptMs.delete(id);
  if (shouldForgetActivity(activity.get(id))) {
    activity.delete(id);
    hiddenSessions.delete(id); // the hidden flag rides with the record — see shouldForgetActivity
  }
  try {
    entry.term.kill();
  } catch {
    // already gone
  }
  // Killing the pty only DETACHES a tmux client — end the tmux session too so an
  // explicit close / idle reap actually stops the program (no orphan within a live
  // server). A server crash never runs this, so sessions survive that (the point).
  if (entry.tmux) tmuxKillSession(id);
  // A sandbox container likewise outlives its killed `docker run` client — force-remove
  // it (and drop the throwaway per-session config).
  if (entry.sandbox) cleanupSandbox(id);
  // A provider session's settings file holds its token — drop it with the session (#579).
  cleanupSessionSettings(id);
  deps.publish(SESSIONS_CHANNEL, { id, working: false, event: "closed" });
}

// Publish a session's current activity (working + waiting) to subscribers.
function publishActivity(deps: SessionLifecycleDeps, id: string) {
  const a = activity.get(id);
  // `cwd` rides along so the attention-sound player can pick up that directory's custom
  // sound (<cwd>/.mulmoterminal.json). Null for a session with no live PTY.
  const cwd = ptys.get(id)?.cwd ?? null;
  if (shouldRefreshReply(a, cwd)) refreshLastResponse(id, cwd);
  const row = sessionRow(id, a, cwd, {
    lastPrompt: lastPrompts.get(id),
    aiTitle: aiTitles.get(id),
    lastResponse: lastResponses.get(id),
  });
  deps.sessionActivityPublisher.publish(id, { working: row.working, waiting: row.waiting });
  deps.publish(SESSIONS_CHANNEL, row);
}

// Claude is thinking (UserPromptSubmit) until it finishes (Stop). No-op (and no
// publish) when the state is unchanged.
function setWorking(deps: SessionLifecycleDeps, id: string, working: boolean, event?: string) {
  const next = nextActivity(activity.get(id), { working }, event, Date.now());
  if (!next) return;
  activity.set(id, next);
  publishActivity(deps, id);
  // Persist `working` so an in-progress turn survives a restart (see ACTIVITY_STATE_FILE).
  persistActivityState((id) => hiddenSessions.has(id));

  // A background session (no attached client) that just finished a turn is no
  // longer `working`. Don't kill it outright — if it ended its turn to ask the
  // user something (it'll be flagged `waiting`), reaping now would lose the task
  // before the user can answer. Arm a reap whose grace matches its state.
  if (!working) armReapForDetached(deps, id);
}

// A background session needs the user's attention: it is waiting for input
// (Notification: permission / question / idle) or has finished a turn with
// output the user hasn't seen (Stop). Cleared when brought to the foreground
// (see the WebSocket connection handler).
function setWaiting(deps: SessionLifecycleDeps, id: string, waiting: boolean, event?: string) {
  const next = nextActivity(activity.get(id), { waiting }, event, Date.now());
  if (!next) return;
  activity.set(id, next);
  publishActivity(deps, id);
  // Persist the blocked/done set so it survives a server restart (see ACTIVITY_STATE_FILE).
  persistActivityState((id) => hiddenSessions.has(id));

  // A detached session that just started needing the user escalates from the short
  // idle grace to the long one — re-arm so it isn't reaped before they can return.
  if (waiting) armReapForDetached(deps, id);
}

export function createSessionLifecycle(deps: SessionLifecycleDeps) {
  return {
    refreshLastResponse,
    cancelReap,
    scheduleReap: (id: string, delayMs?: number) => scheduleReap(deps, id, delayMs),
    armReapForDetached: (id: string) => armReapForDetached(deps, id),
    reap: (id: string) => reap(deps, id),
    publishActivity: (id: string) => publishActivity(deps, id),
    setWorking: (id: string, working: boolean, event?: string) => setWorking(deps, id, working, event),
    setWaiting: (id: string, waiting: boolean, event?: string) => setWaiting(deps, id, waiting, event),
  };
}
