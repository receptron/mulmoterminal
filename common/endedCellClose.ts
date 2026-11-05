// When an agent cell closes itself because its session ended (#3049). Shared because the server
// measures the startup window for its exit log and the browser decides the close from the same one.

// Under this, an exit is a failure to start rather than an ending. Claude Code takes ~1.5s to
// draw its first frame here, so anything inside this window is a process that never got going.
export const STARTUP_WINDOW_MS = 2000;

export interface EndedCellExit {
  /** The server reaped the session — not merely lost the tmux client, which leaves the agent running. */
  sessionEnded: boolean;
  /** How long the pty lived, or null when the frame named none. Under tmux the exit code is the
   *  client's and reads 0 even for an agent that failed to start, so the lifetime is what is left
   *  to tell a launch failure, whose banner must stay readable, from an agent that was ended. */
  lifetimeMs: number | null;
  /** The pty attached to an agent that was already running, so its lifetime is not the agent's
   *  and an exit soon after the attach is an ending, not a launch failure. */
  reattached: boolean;
  /** A worktree cell's close asks whether to keep the worktree; that is not asked unprompted. */
  worktreeCell: boolean;
  /** The program's own exit code where tmux recorded it (#3272), else the client's 0 — or null when
   *  the frame named none. A crash keeps its cell, so its red banner is there to be read. */
  exitCode: number | null;
}

export function shouldCloseEndedCell(exit: EndedCellExit): boolean {
  if (!exit.sessionEnded || exit.worktreeCell) return false;
  if (exit.exitCode !== null && exit.exitCode !== 0) return false;
  if (exit.reattached) return true;
  return exit.lifetimeMs !== null && exit.lifetimeMs >= STARTUP_WINDOW_MS;
}
