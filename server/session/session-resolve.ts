// Pure decision for how a /ws connection should (re)connect a requested session id.
// Split out from index.ts so the flag choice — the one that decides `--resume` vs
// `--session-id` — is unit-testable without a pty, tmux, or the filesystem.

export interface SessionFacts {
  // A live pty for this id in THIS server process (reattach without respawning claude).
  hasLivePty: boolean;
  // A persistent tmux session for this id is alive (survived a restart / another cell).
  tmuxAlive: boolean;
  // An on-disk transcript exists in the target workspace (claude writes it after the
  // first prompt) — the only id claude will `--resume`.
  onDisk: boolean;
  // That transcript is FROZEN: the user ran `/clear`, so claude minted itself a new id and this
  // file is the conversation they ended (`cleared-transcripts.ts`, #1085). Resuming it brings the
  // cleared conversation back — and puts it in the next turn's request (#2013).
  cleared: boolean;
}

export interface SessionResolution {
  reattachId: string | null; // reattach this same-process pty (no new claude)
  resume: string | null; // `--resume` this on-disk transcript
  sessionId: string; // the id claude effectively runs as
}

// `resume` is set whenever a transcript exists on disk — REGARDLESS of tmux liveness.
// An on-disk id must never be launched under `--session-id`: claude refuses it with
// "Session ID <id> is already in use." When a tmux session is alive the arg is ignored
// (tmux attaches to the running claude), but if that session died since we checked it
// (reap, /exit, or another instance on the shared tmux server), `tmux new-session -A`
// re-creates it and RUNS the command — and there `--resume <id>` reattaches the
// conversation where `--session-id <id>` would abort. Gating `resume` on `!tmuxAlive`
// (the old behavior) left that window fatal.
export function resolveSession(requested: string | null, facts: SessionFacts, mintId: () => string): SessionResolution {
  const reattachId = requested && facts.hasLivePty ? requested : null;
  // A cleared transcript is never resumed — it is the conversation the user ENDED, and `--resume`
  // brings it back into the next turn's request (#2013).
  //
  // Including while tmux says it is holding the session, which costs something and is still right.
  // `tmuxAlive` is a probe: if that session dies before the spawn, `tmux new-session -A` runs the
  // command, and there `--session-id <id>` against an id that is on disk makes claude refuse
  // outright ("Session ID is already in use"). Keeping `--resume` for that window would instead
  // resurrect the frozen conversation silently — the exact thing this decision exists to stop
  // (Codex, PR #2014). A spawn that fails loudly is the better half of that trade: the next
  // connect finds no tmux session, and mints a fresh id.
  const resume = !reattachId && requested && facts.onDisk && !facts.cleared ? requested : null;
  // Reuse the requested id when we can actually serve it (reattach, a live tmux
  // session, or an on-disk transcript to resume); otherwise it can't be reused —
  // mint a fresh one.
  const sessionId = reattachId ?? (requested && (facts.tmuxAlive || resume) ? requested : mintId());
  return { reattachId, resume, sessionId };
}

// ── the same decision for the two non-claude terminals ─────────────────────────

/** Which id a launcher or codex connection runs as. A live pty in this process always
 *  wins; otherwise the requested id is reused only when something can actually serve it
 *  (a surviving tmux session, or — for codex — a rollout to resume). Anything else mints
 *  a fresh id, because reusing an id nothing can serve strands the client on a dead one. */
export function resolveReattachableId(
  requested: string | null,
  facts: { hasLivePty: boolean; tmuxAlive: boolean; canResume: boolean },
  mintId: () => string,
): { reattachId: string | null; sessionId: string } {
  const reattachId = requested && facts.hasLivePty ? requested : null;
  const sessionId = reattachId ?? (requested && (facts.tmuxAlive || facts.canResume) ? requested : mintId());
  return { reattachId, sessionId };
}

/**
 * Whether a connection CONTINUES a session rather than creating one.
 *
 * Both resolvers above keep the requested id exactly when something can serve it — a live pty, a
 * surviving tmux session, a transcript or rollout to resume — and mint a fresh one otherwise. So
 * the id they settled on already answers this, and reading it here is what stops a caller from
 * re-listing those cases and missing one: the first version of the worktree limit did exactly
 * that, omitting tmux-only liveness, which reads a reconnect after a server restart as a brand-new
 * session (#1208, caught by Codex).
 */
export const isContinuingSession = (requested: string | null, sessionId: string): boolean => requested !== null && requested === sessionId;

/** Whether a launcher connection may start at all. A reattach needs no launcher index —
 *  the pty already IS the chosen program — and the header's "new terminal" button runs the
 *  default shell with no configured index. Otherwise the index must name a real launcher,
 *  or there is nothing to run. */
export function canStartLauncher(facts: { hasLivePty: boolean; tmuxAlive: boolean; hasLauncher: boolean; isShell: boolean }): boolean {
  return facts.hasLivePty || facts.tmuxAlive || facts.hasLauncher || facts.isShell;
}
