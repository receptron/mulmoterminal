// How an agent's pane ended, which our pty cannot see (#3272).
//
// Under tmux our pty is the CLIENT, and a client whose session closed exits 0 whatever the program
// inside did — so a crash and an `/exit` arrive as the same frame and the cell closes on both. So
// the agent is started under a small `sh` that waits for it and writes its exit status to a file
// named after the session; a death by signal N reads as 128 + N, the shell's own convention.
//
// Not tmux's `remain-on-exit` + `pane-died`, which was tried first: under load the hook sometimes
// never ran while `remain-on-exit` did, leaving a dead pane on screen for good with the session
// still alive. A wrapper cannot do that — when it exits, the pane closes exactly as before.

/** Under the home directory, beside the tmux conf. */
export const PANE_EXIT_DIR_SEGMENTS: readonly string[] = [".mulmoterminal", "pane-exits"];

/** Set on the tmux session so a session that outlived this process still says which agent it runs:
 *  its pane's running command is now the wrapper's `sh`, not the agent. */
export const SESSION_AGENT_ENV = "MULMOTERMINAL_SESSION_AGENT";

/** The shell the wrapper runs under. Absolute, so a pane PATH that lost `/bin` still starts it. */
const WRAPPER_SHELL = "/bin/sh";

/**
 * `$1` is the session name, the rest is the agent's own argv, run unquoted-safe through `"$@"`.
 *
 * `trap :` rather than `trap ''`: an IGNORED signal stays ignored across exec, so the agent would
 * lose Ctrl+C; a HANDLED one is reset to default in it. The wrapper shares the agent's process
 * group, so without the trap the first Ctrl+C would end the wrapper and the agent with it. The path
 * is spelled with `"$HOME"` so no path is quoted into the script.
 */
const WRAPPER_SCRIPT = [
  "n=$1; shift",
  "trap : INT QUIT",
  '"$@"',
  "s=$?",
  `d="$HOME/${PANE_EXIT_DIR_SEGMENTS.join("/")}"`,
  'mkdir -p "$d" && printf %s "$s" > "$d/$n"',
  'exit "$s"',
].join("; ");

/** The pane's program and argv with the recorder around them. */
export function paneExitWrapped(sessionName: string, file: string, args: readonly string[]): { file: string; args: string[] } {
  return { file: WRAPPER_SHELL, args: ["-c", WRAPPER_SCRIPT, "mulmoterminal-exit-recorder", sessionName, file, ...args] };
}

/** The recorded status, or null when the record says nothing usable. */
export function parsePaneExitRecord(record: string): number | null {
  const trimmed = record.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}
