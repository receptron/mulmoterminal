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
  const resume = !reattachId && requested && facts.onDisk ? requested : null;
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

/** Whether a launcher connection may start at all. A reattach needs no launcher index —
 *  the pty already IS the chosen program — and the header's "new terminal" button runs the
 *  default shell with no configured index. Otherwise the index must name a real launcher,
 *  or there is nothing to run. */
export function canStartLauncher(facts: { hasLivePty: boolean; tmuxAlive: boolean; hasLauncher: boolean; isShell: boolean }): boolean {
  return facts.hasLivePty || facts.tmuxAlive || facts.hasLauncher || facts.isShell;
}
