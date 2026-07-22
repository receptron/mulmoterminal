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

import type { SessionAgent } from "./terminalScreen.js";

// Strip ALL control bytes (C0/C1 — ESC, Ctrl-C, CR/LF, and an embedded
// bracketed-paste terminator). Only printable text survives, whitespace collapsed.
// eslint-disable-next-line no-control-regex -- intentional: match terminal control bytes (C0/C1) to strip them
const CONTROL_BYTES_RE = /[\u0000-\u001F\u007F-\u009F]+/g;

export const sanitizeTerminalInput = (text: string): string => text.replace(CONTROL_BYTES_RE, " ").replace(/\s+/g, " ").trim();

export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

// An agent's input box keeps whatever the user typed on the host until they submit it,
// so a paste lands AFTER that draft and the two are submitted merged — "yes I already
// typed this" + "ok" arrives as "yes I already typedthisok" (#572). Ctrl-C empties the
// box in one keystroke; Ctrl-U and Ctrl-A/Ctrl-K only clear the current VISUAL row and
// leave a wrapped draft behind, and Esc does nothing to it. Measured against a live
// Claude TUI, which also showed the clear can ride in the SAME write as the paste (no
// extra delay) and is a no-op on an already-empty box.
export const CLEAR_BOX = "\x03";

// Who may have their box cleared. Ctrl-C is destructive everywhere the host cannot
// vouch for the session's state — mid-turn it interrupts the turn, and in a shell it
// kills whatever is running — so this says yes only for a Claude the host has SEEN
// finish a turn.
//
// `working === false`, not `!== true`: a missing activity record means nobody has
// reported on this session yet, which is emphatically not the same as idle. A session
// spawned with an initialPrompt runs its first turn before any hook has fired
// (spawn-claude.ts), and setWorking(id, false) doesn't even create a record — so
// "unknown" covers a live turn, and reading it as idle would interrupt one.
//
// Codex is excluded despite its TUI clearing identically: nothing calls setWorking for
// a codex session (only Claude's activity hooks do), so `working` never turns true there
// and "idle" would be a guess. Include it once its turn state is tracked.
export const canClearInputBox = (agent: SessionAgent | null | undefined, working: boolean | undefined): boolean => agent === "claude" && working === false;

// Matches DRAFT_SUBMIT_MS in server/index.ts: the same TUI, the same reason.
export const SUBMIT_DELAY_MS = 150;

export interface TerminalInputDeps {
  // Write a chunk to the session's live PTY. False when no PTY is attached in this
  // process — a tmux session that outlived a restart is viewable (capture-pane) but
  // not writable from here.
  writeToSession: (sessionId: string, chunk: string) => boolean;
  // Whether the box can be emptied before pasting (see CLEAR_BOX). True only where the
  // host KNOWS the session is idle, because Ctrl-C mid-turn interrupts the turn and in
  // a shell it kills whatever is running. Omitted means no — the old behaviour of
  // pasting on top of whatever is there.
  canClearBox?: (sessionId: string) => boolean;
  // Injected so tests don't wait on real time.
  scheduleSubmit?: (submit: () => void) => void;
}

const defaultSchedule = (submit: () => void): void => {
  setTimeout(submit, SUBMIT_DELAY_MS);
};

// Paste, then press Enter a beat later, resolving once the Enter has gone out.
const typeAndSubmit = (deps: TerminalInputDeps, sessionId: string, safe: string): Promise<void> => {
  const clear = deps.canClearBox?.(sessionId) ? CLEAR_BOX : "";
  if (!deps.writeToSession(sessionId, `${clear}${PASTE_START}${safe}${PASTE_END}`)) {
    return Promise.reject(new Error(`session ${sessionId} has no live terminal on this host`));
  }
  return new Promise((resolve) => {
    (deps.scheduleSubmit ?? defaultSchedule)(() => {
      // Best-effort: the session can end between the paste and the Enter, and there
      // is nothing to report by then — the paste already landed.
      deps.writeToSession(sessionId, "\r");
      resolve();
    });
  });
};

// Types lines into sessions, one at a time per session.
//
// The Enter is deliberately a separate, delayed write, which means two sends that
// overlap would interleave as paste-A, paste-B, CR, CR — the terminal would run the
// two commands merged into one line, then submit an empty one. So each session gets
// a chain: a send waits for the previous send's Enter before its own paste.
// Different sessions never wait on each other.
export const createTerminalInputSender = (deps: TerminalInputDeps) => {
  const chains = new Map<string, Promise<void>>();

  return async (sessionId: string, text: string): Promise<{ sent: boolean }> => {
    const safe = sanitizeTerminalInput(text);
    if (!safe) {
      throw new Error("text is required");
    }
    // A failed send must not poison the chain for the next one, so the stored link
    // swallows the error; the caller still sees it through `run`.
    const previous = chains.get(sessionId) ?? Promise.resolve();
    const run = previous.then(() => typeAndSubmit(deps, sessionId, safe));
    const link = run.catch(() => undefined);
    chains.set(sessionId, link);
    // Drop the entry once it is the last one, so sessions don't accumulate forever.
    link.then(() => {
      if (chains.get(sessionId) === link) {
        chains.delete(sessionId);
      }
    });
    await run;
    return { sent: true };
  };
};
