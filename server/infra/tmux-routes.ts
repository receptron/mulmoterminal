import type { Express } from "express";

// Deps injected from index.ts so the origin guard, session-id validation, and the
// orphan-selection boundary are unit-testable without booting the server (mirrors
// gitRemote / open-dir / command-summary).
export interface TmuxRouteDeps {
  isAllowedOrigin: (origin?: string) => boolean;
  isValidSessionId: (id: string) => boolean;
  // Reap a live session (kills its pty + tmux + cleanup); a no-op without a live entry.
  reapSession: (id: string) => void;
  hasTmux: (id: string) => boolean;
  killTmux: (id: string) => void;
  listTmuxIds: () => string[];
  // Clients attached to a tmux session, or null when tmux can't say. Each mulmoterminal
  // holds ONE client per session it is live on; the cleanup only reaches ids this process
  // is NOT live on, so any count >= 1 means ANOTHER process is holding it.
  attachedClientCount: (id: string) => number | null;
  // Build the resumability predicate for a cleanup pass (awaits any hydration, snapshots
  // the live / grid / on-disk sets). A tmux id is reaped only when it returns false.
  resumablePredicate: () => Promise<(id: string) => boolean>;
}

// Whether an orphan tmux session is safe to reap. Not resumable is necessary but not
// sufficient: a second mulmoterminal process may have just created it (no transcript yet)
// and be attached to it. We only reach here for ids THIS process isn't live on, so any
// attached client is someone else — and a null count (tmux couldn't say) is treated as
// "held", never killing what we can't confirm is free. Pure, hence unit-testable.
export function orphanReapable(resumable: boolean, attachedCount: number | null): boolean {
  if (resumable) return false;
  return attachedCount === 0;
}

export function mountTmuxRoutes(app: Express, deps: TmuxRouteDeps): void {
  // Explicit close (the cell's ✕): reap NOW — kill the pty AND its tmux — instead of
  // leaving it for the disconnect grace. Works even when the WS is down, and kills a tmux
  // orphaned by a prior server restart (reap alone is a no-op without a live entry).
  app.post("/api/session/:id/terminate", (req, res) => {
    if (!deps.isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });
    const id = req.params.id;
    if (!deps.isValidSessionId(id)) return res.status(400).json({ error: "invalid session id" });
    deps.reapSession(id); // live entry → kills pty + tmux + cleanup
    if (deps.hasTmux(id)) deps.killTmux(id); // orphan (e.g. post-restart) → kill directly
    return res.json({ ok: true });
  });

  // One-shot cleanup of orphaned tmux sessions: reap any that is neither live nor
  // resumable (a persisted grid session, or a Claude/Codex transcript on disk). These
  // accumulate across server restarts, which the in-memory reap bookkeeping can't reach.
  app.post("/api/tmux/cleanup-orphans", async (req, res) => {
    if (!deps.isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });
    const isResumable = await deps.resumablePredicate();
    const killed: string[] = [];
    for (const id of deps.listTmuxIds()) {
      // Skip a session another running mulmoterminal is attached to — killing it would
      // yank a live session out from under that process (#747).
      if (!orphanReapable(isResumable(id), deps.attachedClientCount(id))) continue;
      deps.killTmux(id);
      killed.push(id);
    }
    return res.json({ killed, killedCount: killed.length });
  });
}
