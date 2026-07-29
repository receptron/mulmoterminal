// One-shot completion hooks for background worker sessions: a callback fired when a hidden
// worker finishes, so whoever dispatched it learns the outcome without polling. The feeds
// engine registers one per scheduled agent-ingest refresh to count consecutive failures and
// raise/clear its failure bell.
//
// Ported from MulmoClaude's `server/agent/backgroundSessions.ts`, which owns the same seam
// for the same engine — SAME function names and the same one-shot contract, so the two hosts
// answer the feeds engine identically.
//
// DELIBERATE DIVERGENCE, and it is the whole difficulty: MulmoClaude runs the agent IN
// PROCESS, so its `didError` falls out of a try/catch around the run. MulmoTerminal runs
// `claude` as a PTY child, and there is nothing to wrap. Its callers derive the outcome from
// which lifecycle events a session reached instead — see the Stop / reap call sites.
//
// Best-effort by design: a server restart mid-run drops the map, but the next scheduled tick
// re-dispatches the refresh anyway, so nothing is permanently lost.
import { SESSION_ID_RE } from "../config/env.js";

export type CompletionHook = (outcome: { didError: boolean }) => void | Promise<void>;

const completionHooks = new Map<string, CompletionHook>();

/** Register a one-shot hook for a background worker session. Last writer wins. */
export function registerCompletionHook(sessionId: string, hook: CompletionHook): void {
  if (!SESSION_ID_RE.test(sessionId)) return;
  completionHooks.set(sessionId, hook);
}

/** Drop a hook whose dispatch never produced a run, so nothing will ever fire it. */
export function unregisterCompletionHook(sessionId: string): void {
  completionHooks.delete(sessionId);
}

/** Fire a session's hook, if one is registered, then drop it so it cannot fire twice.
 *
 *  ONE-SHOT is load-bearing, not a nicety. The success and failure call sites both fire
 *  unconditionally — a finished turn reports success, and the later teardown of that same
 *  session reports failure — and it is this function dropping the hook that makes the FIRST
 *  answer the real one. Reversing that would report every successful refresh as failed the
 *  moment it was cleaned up.
 *
 *  The lookup and the call live together on purpose: the invoked value is then always a
 *  closure WE stored under a server-generated id, never one a caller selected by a
 *  request-derived key. A throwing hook rejects, for the caller to catch and log. */
export async function runCompletionHook(sessionId: string, outcome: { didError: boolean }): Promise<void> {
  if (!SESSION_ID_RE.test(sessionId)) return;
  const hook = completionHooks.get(sessionId);
  if (!hook) return;
  completionHooks.delete(sessionId);
  await hook(outcome);
}
