// What a terminal WebSocket message means, separated from carrying it out.
//
// handleMessage does the I/O — writing to xterm, flipping status, firing handlers — but the
// decisions underneath are the fragile part: which messages are terminal (so reconnect must
// NOT retry them), which fire onExit (so a cell offers a re-run), and the wording. The one
// that bites is `superseded`: it is terminal like `exit`, but it must NOT fire onExit, or a
// cell offers to re-run a session that is alive in another tab — and if it were treated as
// retryable, the two tabs would evict each other forever. This is exactly why it wants a test.

// The non-output effects of a message. `output` is handled directly (a hot path, just a
// write) and is not modelled here.
export interface MessageEffect {
  // A terminal message stops the connection — reconnect must not retry it.
  terminal: boolean;
  // Fire the onExit handler (a CommandCell uses it to offer a re-run). Deliberately false for
  // `superseded`: the session is still alive elsewhere.
  callsOnExit: boolean;
  // The line written to the terminal, or null (session/output write nothing here).
  banner: string | null;
}

const GREEN = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const line = (colour: string, text: string) => `\r\n${colour}${text}${RESET}\r\n`;

// A program that could not run at all leaves nothing else to read: it writes no output, and
// under tmux whatever the pane did print is wiped by the alt-screen restore on the way out. The
// status is then the only evidence there was, so a non-zero one is named and coloured rather
// than folded into the same "[session ended]" a clean exit gets (#1063).
const exitBanner = (isCommand: boolean, exitCode: number | null): string => {
  const what = isCommand ? "finished" : "session ended";
  if (exitCode === null || exitCode === 0) return line(GREEN, `[${what}]`);
  return line(RED, `[${what} — exit ${exitCode}]`);
};

// `isCommand` is whether this slot runs a one-off Run command rather than an agent session —
// it only changes the wording of the exit banner.
export function messageEffect(type: string | undefined, isCommand: boolean, errorMessage?: unknown, exitCode: number | null = null): MessageEffect {
  switch (type) {
    case "exit":
      return { terminal: true, callsOnExit: true, banner: exitBanner(isCommand, exitCode) };
    case "superseded":
      return { terminal: true, callsOnExit: false, banner: line(GREEN, "[detached — this session is open in another window]") };
    case "error": {
      const detail = typeof errorMessage === "string" ? errorMessage : "failed to start";
      return { terminal: true, callsOnExit: true, banner: line(RED, `[${detail}]`) };
    }
    default:
      return { terminal: false, callsOnExit: false, banner: null };
  }
}

/** The status the server reported for a finished PTY, or null when it named none — a command
 *  that never started, or a session that ended without one. Pure and here rather than inline in
 *  the socket handler because a Run cell turns it into "done" vs "failed", and answering 0 for
 *  a missing code would call a broken build a success. */
export const exitCodeOf = (msg: { exitCode?: unknown }): number | null => (typeof msg.exitCode === "number" ? msg.exitCode : null);
