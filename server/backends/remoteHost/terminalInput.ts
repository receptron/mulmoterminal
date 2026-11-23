// Typing into a live session from the phone (#445). The wire side is one string;
// everything that makes it land correctly in a TUI lives here so it can be tested
// without a PTY.
//
// Four things matter; the first three are learned behaviour from the spawn paths in
// server/index.ts:
//
//   1. Sanitize first. The text arrives from a phone, so it is untrusted: an
//      embedded bracketed-paste terminator (\e[201~) or a bare ESC/Ctrl-C would
//      break out of the paste and run as control input on the host's terminal.
//   2. Wrap in bracketed paste, so a TUI treats it as pasted text rather than
//      keystrokes it might interpret one by one.
//   3. Send the submitting Enter as a SEPARATE write a beat later — Claude's TUI
//      drops a CR that arrives while it is still committing the paste.
//   4. For a CLAUDE session, end the pasted line with a space (submittableLine) so no
//      completion menu is open when that Enter lands. An open menu takes the key for
//      itself: it eats the ESC of an ESC+CR submit, and the `@path` picker eats even a
//      plain CR — which is why the guard is not scoped to the reversed submit mapping.
//      Claude-only because anywhere else that space is real input: a shell line ending
//      in `\` escapes the newline, and with a space appended it runs instead.

import type { SessionAgent } from "../../../common/sessionAgent.js";
import { submittableLineForAgent } from "../../../common/terminalSubmit.js";

// Strip ALL control bytes (C0/C1 — ESC, Ctrl-C, CR/LF, and an embedded
// bracketed-paste terminator). Only printable text survives, whitespace collapsed.
// eslint-disable-next-line no-control-regex -- intentional: match terminal control bytes (C0/C1) to strip them
const CONTROL_BYTES_RE = /[\u0000-\u001F\u007F-\u009F]+/g;

// The closing `.trim()` is load-bearing, not cosmetic: a control byte becomes a SPACE (so `a\nb`
// cannot become `ab`), which manufactures whitespace the sender never typed — `"\x03"` arrives as
// `" "`. Trimming is what turns that into `""`, and `""` is what lets the caller reject text with
// nothing printable in it rather than submit an empty turn on the host; a leading space would also
// reach a shell for real (`HISTCONTROL=ignorespace`). Text that needs to END in a space to submit
// gets that from submittableLine, AFTER this emptiness decision — never by trimming less (#1142).
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
  canClearBox?: ((sessionId: string) => boolean) | undefined;
  // The byte(s) that SUBMIT for this session (#772). The `terminalSubmit` mapping is the
  // host's Claude binding, so it applies only to Claude sessions — resolved per session id
  // (a shell/codex session in the picker stays on plain CR). Read per send so a config edit
  // applies without a restart. Omitted defaults to CR — the historical behaviour.
  submitSequence?: (sessionId: string) => string;
  // Which agent runs in this session, for the completion-menu guard below — only Claude Code has
  // the menu, and only there is a trailing space not real input (#1142). Omitted, or an agent the
  // host cannot name, means no guard: the bytes stay exactly what the sender wrote.
  sessionAgent?: (sessionId: string) => SessionAgent | undefined;
  // Injected so tests don't wait on real time.
  scheduleSubmit?: (submit: () => void) => void;
}

const defaultSchedule = (submit: () => void): void => {
  setTimeout(submit, SUBMIT_DELAY_MS);
};

// Paste, then press Enter a beat later, resolving once the Enter has gone out.
//
// A Claude session's pasted line ends with submittableLine's space, so no completion menu is
// holding the submit byte(s). The space rides INSIDE the paste, where the TUI takes it as text:
// sent after the terminator it would be a keystroke, which an open menu is exactly what reads.
const typeAndSubmit = (deps: TerminalInputDeps, sessionId: string, safe: string): Promise<void> => {
  const clear = deps.canClearBox?.(sessionId) ? CLEAR_BOX : "";
  const line = submittableLineForAgent(deps.sessionAgent?.(sessionId), safe);
  if (!deps.writeToSession(sessionId, `${clear}${PASTE_START}${line}${PASTE_END}`)) {
    return Promise.reject(new Error(`session ${sessionId} has no live terminal on this host`));
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

/** Thrown when a send's `blocked` check says no. The paste may already be in the input box when it
 *  comes from the second check; nothing is submitted either way. */
export class InputBlockedError extends Error {
  /** True when the paste had already landed: the line is sitting in the input box, unsubmitted. */
  readonly afterPaste: boolean;
  constructor(message?: string, afterPaste = false) {
    super(message);
    this.afterPaste = afterPaste;
  }
}

/** What a single send may ask of the sender. */
export interface SendOptions {
  /** Asked right before the paste and again right before the Enter, inside this session's chain.
   *  True stops the send: before the paste nothing is written; before the Enter the line stays in
   *  the input box unsubmitted. The board's reply passes "a question dialog is open" (#3185), since a
   *  dialog can open between a check made earlier and the write. */
  blocked?: () => Promise<boolean>;
}

// typeAndSubmit with the `blocked` check at both writes. A separate function so a send without the
// option keeps the exact path it always had, timing included.
const guardedTypeAndSubmit = async (deps: TerminalInputDeps, sessionId: string, safe: string, blocked: () => Promise<boolean>): Promise<void> => {
  if (await blocked()) throw new InputBlockedError(`session ${sessionId} is blocked from input`);
  const clear = deps.canClearBox?.(sessionId) ? CLEAR_BOX : "";
  const line = submittableLineForAgent(deps.sessionAgent?.(sessionId), safe);
  if (!deps.writeToSession(sessionId, `${clear}${PASTE_START}${line}${PASTE_END}`)) {
    throw new Error(`session ${sessionId} has no live terminal on this host`);
  }
  const submit = deps.submitSequence?.(sessionId) ?? "\r";
  await new Promise<void>((resolve) => (deps.scheduleSubmit ?? defaultSchedule)(resolve));
  if (await blocked()) throw new InputBlockedError(`session ${sessionId} became blocked before its Enter; the line was left unsubmitted`, true);
  deps.writeToSession(sessionId, submit);
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

  return async (sessionId: string, text: string, options: SendOptions = {}): Promise<{ sent: boolean }> => {
    const safe = sanitizeTerminalInput(text);
    if (!safe) {
      throw new Error("text is required");
    }
    // A failed send must not poison the chain for the next one, so the stored link
    // swallows the error; the caller still sees it through `run`.
    const previous = chains.get(sessionId) ?? Promise.resolve();
    const { blocked } = options;
    const run = previous.then(() => (blocked ? guardedTypeAndSubmit(deps, sessionId, safe, blocked) : typeAndSubmit(deps, sessionId, safe)));
    const link = run.catch(() => undefined);
    chains.set(sessionId, link);
    // Drop the entry once it is the last one, so sessions don't accumulate forever.
    void link.then(() => {
      if (chains.get(sessionId) === link) {
        chains.delete(sessionId);
      }
    });
    await run;
    return { sent: true };
  };
};
