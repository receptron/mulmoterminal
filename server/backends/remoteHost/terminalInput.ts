// Writing into a live session from the phone: typing a line (#445) and pressing a key
// (#781). The wire side is one string or one list of key names; everything that makes it
// land correctly in a TUI lives here so it can be tested without a PTY.
//
// For TYPING, three things matter, and all three are learned behaviour from the spawn
// paths in server/index.ts:
//
//   1. Sanitize first. The text arrives from a phone, so it is untrusted: an
//      embedded bracketed-paste terminator (\e[201~) or a bare ESC/Ctrl-C would
//      break out of the paste and run as control input on the host's terminal.
//   2. Wrap in bracketed paste, so a TUI treats it as pasted text rather than
//      keystrokes it might interpret one by one.
//   3. Send the submitting Enter as a SEPARATE write a beat later — Claude's TUI
//      drops a CR that arrives while it is still committing the paste.
//
// A KEY PRESS is the exact opposite and shares none of it: the bytes are the host's own
// (terminalKeys.ts), so there is nothing to sanitize, and a menu wants keystrokes rather
// than a paste. What the two paths DO share is the per-session write chain — see
// sessionChain.ts.

import { createSessionChain } from "./sessionChain.js";
import { keyBytes, type TerminalKeyName } from "./terminalKeys.js";
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

// Between two keys of one send. Same reason as SUBMIT_DELAY_MS: a TUI re-rendering after a
// highlight move can drop a key that arrives in that same tick, and "the arrow did nothing
// but the Enter took effect" is exactly what #781 measured. Our tmux runs escape-time 0
// (server/infra/tmux.ts), so a lone `escape` is forwarded at once rather than held back
// waiting to see whether a longer sequence follows.
export const KEY_INTERVAL_MS = 60;

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
  // The byte(s) that SUBMIT for this session (#772). The `terminalSubmit` mapping is the
  // host's Claude binding, so it applies only to Claude sessions — resolved per session id
  // (a shell/codex session in the picker stays on plain CR). Read per send so a config edit
  // applies without a restart. Omitted defaults to CR — the historical behaviour.
  submitSequence?: (sessionId: string) => string;
  // Injected so tests don't wait on real time.
  scheduleSubmit?: (submit: () => void) => void;
  // The gap between two keys of one send (KEY_INTERVAL_MS). Separate from scheduleSubmit
  // because they answer different questions, and a test drives each independently.
  scheduleKey?: (press: () => void) => void;
}

const defaultSchedule = (submit: () => void): void => {
  setTimeout(submit, SUBMIT_DELAY_MS);
};

const defaultKeySchedule = (press: () => void): void => {
  setTimeout(press, KEY_INTERVAL_MS);
};

const noLiveTerminal = (sessionId: string): Error => new Error(`session ${sessionId} has no live terminal on this host`);

// Paste, then press Enter a beat later, resolving once the Enter has gone out.
const typeAndSubmit = (deps: TerminalInputDeps, sessionId: string, safe: string): Promise<void> => {
  const clear = deps.canClearBox?.(sessionId) ? CLEAR_BOX : "";
  if (!deps.writeToSession(sessionId, `${clear}${PASTE_START}${safe}${PASTE_END}`)) {
    return Promise.reject(noLiveTerminal(sessionId));
  }
  const submit = deps.submitSequence?.(sessionId) ?? "\r";
  return new Promise((resolve) => {
    (deps.scheduleSubmit ?? defaultSchedule)(() => {
      // Best-effort: the session can end between the paste and the Enter, and there
      // is nothing to report by then — the paste already landed.
      deps.writeToSession(sessionId, submit);
      resolve();
    });
  });
};

// Press keys, one write each, spaced by KEY_INTERVAL_MS.
//
// A write that fails throws and the rest are abandoned: unlike the paste's Enter — which is
// best-effort because the paste is already on screen — a half-pressed key list is invisible
// to the phone, so a dead session is reported rather than passed off as sent.
const pressKeys = (deps: TerminalInputDeps, sessionId: string, keys: TerminalKeyName[]): Promise<void> =>
  keys.reduce(
    (previous, key, index) =>
      previous.then(async () => {
        if (index > 0) {
          await new Promise<void>((resolve) => (deps.scheduleKey ?? defaultKeySchedule)(resolve));
        }
        if (!deps.writeToSession(sessionId, keyBytes(key))) {
          throw noLiveTerminal(sessionId);
        }
      }),
    Promise.resolve(),
  );

// Writes into sessions, one send at a time per session (sessionChain.ts) — a phone tapping a
// key row while a typed line is still waiting for its Enter must not land the key inside
// that line.
//
//   sendText — a line, sanitized and pasted, then submitted (#445).
//   sendKeys — key presses, as if at the keyboard: no sanitizing (the bytes are ours), no
//              paste, no box clear, no trailing submit. `enter` is just another key.
export const createTerminalSender = (deps: TerminalInputDeps) => {
  const inOrder = createSessionChain();

  return {
    sendText: async (sessionId: string, text: string): Promise<{ sent: boolean }> => {
      const safe = sanitizeTerminalInput(text);
      if (!safe) {
        throw new Error("text is required");
      }
      await inOrder(sessionId, () => typeAndSubmit(deps, sessionId, safe));
      return { sent: true };
    },

    sendKeys: async (sessionId: string, keys: TerminalKeyName[]): Promise<{ sent: boolean }> => {
      await inOrder(sessionId, () => pressKeys(deps, sessionId, keys));
      return { sent: true };
    },
  };
};
