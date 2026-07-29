// The one place a PTY's start and end are put into words.
//
// Four spawn sites (claude, codex, launcher, run command) each wrote their own pair of lines,
// and the four disagreed on what they carried. Two of the three facts #1063 needed were missing
// from all of them: whether tmux ATTACHED a running program rather than starting one, and how
// long the process lived before it exited.
//
// The lifetime is what separates a failure to start from a user leaving. A process that exits
// 40ms after the spawn never ran; one that exits an hour later was told to. Both used to print
// the same line.
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;

// Under this, an exit is a failure to start rather than an ending. Claude Code takes ~1.5s to
// draw its first frame here, so anything inside this window is a process that never got going.
export const STARTUP_WINDOW_MS = 2000;

/** Whether an exit should read as "it never started". A clean exit never does, however fast:
 *  `--version`-style commands finish in milliseconds and finish correctly. */
export function diedDuringStartup(lifetimeMs: number, exitCode: number): boolean {
  return exitCode !== 0 && lifetimeMs < STARTUP_WINDOW_MS;
}

/** A duration a human reads at a glance. Milliseconds below a second, because that is the range
 *  where the exact number is the whole point. */
export function formatLifetime(ms: number): string {
  if (ms < MS_PER_SECOND) return `${Math.round(ms)}ms`;
  if (ms < MS_PER_MINUTE) return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
  // Rounded to whole seconds FIRST, then split. Splitting first and rounding the remainder
  // renders 1m59.9s as "1m60s", because the two halves round independently.
  const seconds = Math.round(ms / MS_PER_SECOND);
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

export interface PtyStart {
  /** "claude", "codex", "launcher", "command". */
  agent: string;
  pid: number;
  cwd: string;
  /** Whether a tmux session backs this pty at all. */
  tmux: boolean;
  /** Whether tmux ATTACHED a program that was already running instead of starting one. */
  reattached: boolean;
  /** The id this pty is registered under, or null for the run command (which has no session). */
  sessionId?: string | null;
  /** Anything the caller wants after the directory — the launcher's command line, a resume id. */
  note?: string | null;
}

export interface PtyExit {
  agent: string;
  exitCode: number;
  signal: number | undefined;
  /** Milliseconds between the spawn returning and this exit. */
  lifetimeMs: number;
  cwd?: string | null;
  sessionId?: string | null;
}

const trailing = (parts: readonly (string | null | undefined)[]): string =>
  parts
    .filter(Boolean)
    .map((part) => ` — ${part}`)
    .join("");

/** The line a spawn writes. `attached` rather than `started` is the point: on that path the
 *  binary, the argv and the cwd were never used, so nothing about them can be concluded from
 *  the session working (#1063). */
export function ptyStartLine(start: PtyStart): string {
  const what = start.reattached ? `attached to a running ${start.agent}` : `started ${start.agent}`;
  const via = start.tmux ? " via tmux" : "";
  const where = start.sessionId ? `session ${start.sessionId}` : null;
  return `[pty] ${what} (pid=${start.pid}${via}) in ${start.cwd}${trailing([where, start.note])}`;
}

/** Which pty this was: its session and where it ran, or just the directory when it has no
 *  session id of its own (the Run terminal). */
function ptyIdentity(exit: PtyExit): string | null | undefined {
  if (!exit.sessionId) return exit.cwd;
  const where = exit.cwd ? ` in ${exit.cwd}` : "";
  return `session ${exit.sessionId}${where}`;
}

/** The line an exit writes. */
export function ptyExitLine(exit: PtyExit): string {
  const signal = exit.signal === undefined ? "" : ` signal=${exit.signal}`;
  const lifetime = `after ${formatLifetime(exit.lifetimeMs)}`;
  // Named rather than left to the reader: under tmux the process's own error message is gone by
  // the time anyone looks, so this line is the only evidence that it failed to start at all.
  const verdict = diedDuringStartup(exit.lifetimeMs, exit.exitCode) ? "it never finished starting" : null;
  return `[pty] ${exit.agent} exited code=${exit.exitCode}${signal} ${lifetime}${trailing([ptyIdentity(exit), verdict])}`;
}
