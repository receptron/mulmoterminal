// How an agent's pane ended, which our pty cannot see (#3272).
//
// Under tmux our pty is the CLIENT, and a client whose session closed exits 0 whatever the program
// inside did — so a crash and an `/exit` arrive as the same frame and the cell closes on both. tmux
// itself knows: with `remain-on-exit` a dead pane keeps `#{pane_dead_status}` / `#{pane_dead_signal}`
// readable until something kills it. The hook below copies them into a server option named after
// the session, then kills the pane so the session ends exactly as it did before.
//
// Set per SESSION, chained onto the `new-session` that creates it, rather than in the conf: a global
// `remain-on-exit` would leave a dead pane behind in every shell and command cell too if the hook
// ever failed, and a conf line never reaches a server that is already running.

/** Shells and tmux both report a death by signal N as 128 + N. */
const SIGNAL_EXIT_BASE = 128;

/** The server option one session's exit is recorded under. A user option (`@…`), so it is never
 *  exported into any pane's environment the way `set-environment` would be. */
export const paneExitOptionName = (sessionName: string): string => `@mt-exit-${sessionName}`;

/**
 * Appended to `new-session`'s argv: run in the session it creates (or attaches, under `-A`, which
 * is how a session from before this shipped gets it too).
 *
 * The session name is baked into the hook because an option NAME is not format-expanded. `-q` on
 * the recording `set-option` matters more than it looks: a failing command ends the list, and a
 * hook that stops before `kill-pane` leaves a dead pane on screen with the session still "alive".
 */
export function paneExitRecordingArgs(sessionName: string): string[] {
  const record = `set-option -gqF ${paneExitOptionName(sessionName)} '#{pane_dead_status}:#{pane_dead_signal}'`;
  return [";", "set-option", "-w", "remain-on-exit", "on", ";", "set-hook", "pane-died", `${record} ; kill-pane`];
}

/**
 * `status:signal` → the exit code a shell would report, or null when the record says nothing usable.
 *
 * tmux 3.6a on macOS writes the signal as its NAME (`:kill`, `:segv`), not its number, so both are
 * accepted; `signalNumbers` is `os.constants.signals`, injected to keep this free of the host.
 */
export function parsePaneExitRecord(record: string, signalNumbers: ReadonlyMap<string, number>): number | null {
  const match = /^(\d*):(\w*)$/.exec(record.trim());
  if (!match) return null;
  const [, status = "", signal = ""] = match;
  if (status !== "") return Number(status);
  if (signal === "") return null;
  const signalNumber = /^\d+$/.test(signal) ? Number(signal) : signalNumbers.get(`SIG${signal.toUpperCase()}`);
  return signalNumber === undefined ? null : SIGNAL_EXIT_BASE + signalNumber;
}
