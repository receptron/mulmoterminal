// Typing into a live session from the phone (#445). The wire side is one string;
// everything that makes it land correctly in a TUI lives here so it can be tested
// without a PTY.
//
// Three things matter, and all three are learned behaviour from the spawn paths in
// server/index.ts:
//
//   1. Sanitize first. The text arrives from a phone, so it is untrusted: an
//      embedded bracketed-paste terminator (\e[201~) or a bare ESC/Ctrl-C would
//      break out of the paste and run as control input on the host's terminal.
//   2. Wrap in bracketed paste, so a TUI treats it as pasted text rather than
//      keystrokes it might interpret one by one.
//   3. Send the submitting Enter as a SEPARATE write a beat later — Claude's TUI
//      drops a CR that arrives while it is still committing the paste.

// Strip ALL control bytes (C0/C1 — ESC, Ctrl-C, CR/LF, and an embedded
// bracketed-paste terminator). Only printable text survives, whitespace collapsed.
// eslint-disable-next-line no-control-regex -- intentional: match terminal control bytes (C0/C1) to strip them
const CONTROL_BYTES_RE = /[\u0000-\u001F\u007F-\u009F]+/g;

export const sanitizeTerminalInput = (text: string): string => text.replace(CONTROL_BYTES_RE, " ").replace(/\s+/g, " ").trim();

export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

// Matches DRAFT_SUBMIT_MS in server/index.ts: the same TUI, the same reason.
export const SUBMIT_DELAY_MS = 150;

export interface TerminalInputDeps {
  // Write a chunk to the session's live PTY. False when no PTY is attached in this
  // process — a tmux session that outlived a restart is viewable (capture-pane) but
  // not writable from here.
  writeToSession: (sessionId: string, chunk: string) => boolean;
  // Injected so tests don't wait on real time.
  scheduleSubmit?: (submit: () => void) => void;
}

const defaultSchedule = (submit: () => void): void => {
  setTimeout(submit, SUBMIT_DELAY_MS);
};

// Type one line into a session and press Enter. Throws when the text is empty
// after sanitizing, or when the session has no live PTY to write to — the phone
// surfaces the message, which beats a silent no-op it would read as success.
export const sendTerminalInput = (deps: TerminalInputDeps, sessionId: string, text: string): { sent: boolean } => {
  const safe = sanitizeTerminalInput(text);
  if (!safe) {
    throw new Error("text is required");
  }
  if (!deps.writeToSession(sessionId, `${PASTE_START}${safe}${PASTE_END}`)) {
    throw new Error(`session ${sessionId} has no live terminal on this host`);
  }
  // Best-effort: the session can end between the paste and the Enter, and there is
  // nothing to report by then — the paste already landed.
  (deps.scheduleSubmit ?? defaultSchedule)(() => {
    deps.writeToSession(sessionId, "\r");
  });
  return { sent: true };
};
