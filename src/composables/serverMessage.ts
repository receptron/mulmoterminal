// What a terminal WebSocket message means, separated from carrying it out.
//
// handleMessage does the I/O — writing to xterm, flipping status, firing handlers — but the
// decisions underneath are the fragile part: which messages are terminal (so reconnect must
// NOT retry them), which fire onExit (so a cell offers a re-run), and the wording. The one
// that bites is `superseded`: it is terminal like `exit`, but it must NOT fire onExit, or a
// cell offers to re-run a session that is alive in another tab — and if it were treated as
// retryable, the two tabs would evict each other forever. This is exactly why it wants a test.

import { isRecord } from "../../common/isRecord";

// The one place a server frame becomes data — the mirror of the server's own parseClientFrame.
// `JSON.parse` answers `any`, which would put everything read off the frame outside the type
// checker, including the bytes written into the terminal. A frame that is not a JSON object is
// dropped rather than thrown: the caller runs inside `sock.onmessage`, where nothing catches it.
export function parseServerFrame(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  try {
    const msg: unknown = JSON.parse(data);
    return isRecord(msg) ? msg : null;
  } catch {
    return null;
  }
}

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
const exitBanner = (isCommand: boolean, exitCode: number | null, exitUnrecorded: boolean): string => {
  const what = isCommand ? "finished" : "session ended";
  if (exitUnrecorded) return line(RED, `[${what} — how it ended was not recorded; is the disk full?]`);
  if (exitCode === null || exitCode === 0) return line(GREEN, `[${what}]`);
  return line(RED, `[${what} — exit ${exitCode}]`);
};

// `isCommand` is whether this slot runs a one-off Run command rather than an agent session —
// it only changes the wording of the exit banner.
export function messageEffect(
  type: string | undefined,
  isCommand: boolean,
  errorMessage?: unknown,
  exitCode: number | null = null,
  exitUnrecorded = false,
): MessageEffect {
  switch (type) {
    case "exit":
      return { terminal: true, callsOnExit: true, banner: exitBanner(isCommand, exitCode, exitUnrecorded) };
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

/** What an `exit` frame says about the SESSION rather than the pty: whether the server reaped it,
 *  and how long the pty lived (null when the frame names none). Missing reads as "not ended", so a
 *  frame without the field never closes a cell. */
export const sessionExitOf = (msg: {
  ended?: unknown;
  lifetimeMs?: unknown;
  reattached?: unknown;
  exitUnrecorded?: unknown;
  closedOnRequest?: unknown;
}): SessionExit => ({
  sessionEnded: msg.ended === true,
  lifetimeMs: typeof msg.lifetimeMs === "number" && Number.isFinite(msg.lifetimeMs) ? msg.lifetimeMs : null,
  reattached: msg.reattached === true,
  exitUnrecorded: msg.exitUnrecorded === true,
  closedOnRequest: msg.closedOnRequest === true,
});

/** `messageEffect` for a frame as it arrived. */
export const frameEffect = (msg: Record<string, unknown>, isCommand: boolean): MessageEffect =>
  messageEffect(typeof msg.type === "string" ? msg.type : undefined, isCommand, msg.message, exitCodeOf(msg), sessionExitOf(msg).exitUnrecorded);

export interface SessionExit {
  sessionEnded: boolean;
  lifetimeMs: number | null;
  reattached: boolean;
  exitUnrecorded: boolean;
  closedOnRequest: boolean;
}

/** A `paneMode` frame's copy-mode flag (#2207), or null for any frame that does not carry one. Null
 *  rather than false so a malformed frame leaves the banner as it was instead of taking it down. */
export const copyModeOf = (msg: Record<string, unknown>): boolean | null =>
  msg.type === "paneMode" && typeof msg.inCopyMode === "boolean" ? msg.inCopyMode : null;
