# fix: explicit close should kill the tmux session (+ safe orphan cleanup)

Issue: receptron/mulmoterminal#366

## Problem

tmux sessions (`mt-<id>` in the isolated `-L mulmoterminal` server) accumulate — 126
observed, oldest 10 days. Two gaps:

- **Explicit close (the cell's ✕)** reaps via a WS `{type:"terminate"}` → `reap()` →
  `tmuxKillSession()`, but the client only sends it when `ws.readyState === OPEN`
  (`useTerminalConnections.terminate`). A disconnected / reconnecting cell closed with ✕
  never tells the server → tmux leaks. And after a server restart `reap(id)` is a no-op
  (no in-memory entry), so an orphaned tmux is never killed.
- **Server restarts** orphan every live tmux (in-memory `ptys`/reap timers lost). tmux
  surviving a restart is intentional (persistence for resume), so orphans pile up.

## Fix

1. **Reliable explicit close** — `POST /api/session/:id/terminate` (id validated) →
   `reap(id)` + `tmuxKillSession(id)` when a tmux still exists (kills a restart-orphan
   even without a live entry). `TerminalCell.teardown()` calls it over HTTP, so the ✕
   works regardless of socket state. Navigation / tab-close / disconnect keep tmux.
2. **Safe orphan cleanup (option B)** — `POST /api/tmux/cleanup-orphans` reaps only
   `mt-<id>` that is neither **live** (`ptys`) nor **resumable**: a persisted grid session
   (`devTerminalSessions`), a Claude transcript on disk (any project dir), or a Codex
   rollout on disk. A resumable session is never touched. Used to clear the existing 126.

The resumability rule is a pure `isResumableTmuxSession(id, live, grid, claudeOnDisk,
codexOnDisk)` in `tmux.ts`, unit-tested.

## Files

- `server/tmux.ts`: pure `isResumableTmuxSession`.
- `server/index.ts`: `claudeOnDiskSessionIds()` (scan all project dirs); the two endpoints.
- `src/components/TerminalCell.vue`: `teardown()` fires the HTTP terminate (id captured first).
- `server/tmux.spec.ts`: resumability rule tests.

## Acceptance

- Closing a cell with ✕ kills its tmux even if the socket is down / after a restart.
- The cleanup reaps only pure orphans; live/grid/transcript-backed sessions survive.
- Gates green (format / lint / typecheck / typecheck:server / build / test).
