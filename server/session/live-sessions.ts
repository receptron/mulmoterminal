// Which of a given set of sessions still has something RUNNING.
//
// "Running" is a live PTY in this process, or a tmux session that will hand one back when a client
// attaches — the two ways a session survives, and the two the reaper watches. Deliberately not "a
// transcript exists": a transcript is never deleted, so read as liveness it answers yes forever
// (the same trap `isResumableTmuxSession` documents for reaping).
//
// Pure so the rule can be tested without a tmux server or an express app; the route supplies both
// sides of the evidence.

/** The subset of `ids` that is still running, in the order asked. */
export function liveSessionIds(ids: readonly string[], hasPty: (id: string) => boolean, tmuxSessionIds: readonly string[]): string[] {
  const persisted = new Set(tmuxSessionIds);
  return ids.filter((id) => hasPty(id) || persisted.has(id));
}
