// How an agent's pane ended, which our pty cannot see (#3272).
//
// Under tmux our pty is the CLIENT, and a client whose session closed exits 0 whatever the program
// inside did — so a crash and an `/exit` arrive as the same frame and the cell closes on both. tmux
// itself knows: with `remain-on-exit` a dead pane keeps `#{pane_dead_status}` / `#{pane_dead_signal}`
// readable until something kills it. The hook below writes them to a file named after the session,
// then kills the pane so the session ends exactly as it did before.
//
// Set per SESSION, chained onto the `new-session` that creates it, rather than in the conf: a global
// `remain-on-exit` would leave a dead pane behind in every shell and command cell too if the hook
// ever failed, and a conf line never reaches a server that is already running.

/** Shells and tmux both report a death by signal N as 128 + N. */
const SIGNAL_EXIT_BASE = 128;

/** Under the home directory, beside the tmux conf. A FILE, not a tmux option: when the crashed
 *  session was the server's last, the server exits with it and every option it held is gone. */
export const PANE_EXIT_DIR_SEGMENTS: readonly string[] = [".mulmoterminal", "pane-exits"];

/**
 * Appended to `new-session`'s argv: run in the session it creates (or attaches, under `-A`, which
 * is how a session from before this shipped gets it too).
 *
 * The path is spelled with the shell's `"$HOME"` rather than ours: the socket is per HOME, so the
 * server's HOME is ours, and this way no path reaches tmux's parser, its format expander and a
 * shell in turn. The shell always exits 0, because a failing `run-shell` would end the list before
 * `kill-pane` and leave a dead pane on screen. The hook goes in BEFORE `remain-on-exit`, so a
 * program dying between the two leaves nothing behind.
 */
export function paneExitRecordingArgs(sessionName: string): string[] {
  const dir = `"$HOME/${PANE_EXIT_DIR_SEGMENTS.join("/")}"`;
  const write = `mkdir -p ${dir} && printf %s "#{pane_dead_status}:#{pane_dead_signal}" > ${dir}/${sessionName}; exit 0`;
  return [";", "set-hook", "pane-died", `run-shell '${write}' ; kill-pane`, ";", "set-option", "-w", "remain-on-exit", "on"];
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
