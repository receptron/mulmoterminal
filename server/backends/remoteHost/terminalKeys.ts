// The phone PRESSING A KEY in a live session (#781), as opposed to typing a line
// (terminalInput.ts). Claude asks much of what it asks as a select menu — /model, its own
// multiple-choice questions, permission prompts — and a menu answers to key presses, not
// to pasted text: the typing path strips every control byte (so no arrow survives it) and
// wraps the rest in bracketed paste (so a digit arrives as text the menu ignores).
//
// This is a SEPARATE vocabulary rather than a loosened sanitizer. The phone names a key
// and the host owns the bytes, so the trust boundary stays where it was — untrusted input
// still cannot reach the PTY as control bytes of its own choosing.

// Every key the phone may press, and the bytes a terminal emits for it.
//
// Deliberately small: menu navigation and the answers to one. Nothing destructive — Ctrl-C
// interrupts the turn mid-turn and kills whatever is running in a shell, which is too
// expensive for a mis-tap on a phone; Ctrl-D / Ctrl-Z likewise end or suspend the session.
//
// `enter` is the KEY, plain CR, and deliberately does NOT go through the host's submit
// binding (#772): that binding describes Claude's PROMPT BOX, while a menu confirms on CR.
// Committing a typed line is sendTerminalInput's job, and that path still resolves the
// binding per session.
const KEY_BYTES = {
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  enter: "\r",
  escape: "\x1b",
  tab: "\t",
  "shift-tab": "\x1b[Z",
  backspace: "\x7f",
  space: " ",
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
} as const;

export type TerminalKeyName = keyof typeof KEY_BYTES;

export const TERMINAL_KEY_NAMES: readonly string[] = Object.keys(KEY_BYTES);

// hasOwnProperty, not `in`: `"constructor" in KEY_BYTES` is true through the prototype
// chain, and the phone chooses this string — a name that passed would then be looked up to
// a function rather than bytes.
export const isTerminalKeyName = (value: unknown): value is TerminalKeyName =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(KEY_BYTES, value);

export const keyBytes = (name: TerminalKeyName): string => KEY_BYTES[name];

// One send holds the session's write chain for (n - 1) inter-key gaps, so a bound keeps a
// single command from occupying the terminal — and keeps a mis-built request from being a
// way to hold it indefinitely. Sixteen is far past any real tap burst.
export const MAX_KEYS_PER_SEND = 16;

// The `keys` param off the wire → the key names to press. Rejects the whole request rather
// than pressing the prefix it understood: the phone can retry a rejected send, but it
// cannot un-press a key that landed in a menu.
export const parseTerminalKeys = (value: unknown): TerminalKeyName[] => {
  if (!Array.isArray(value)) {
    throw new Error("keys must be an array of key names");
  }
  if (value.length === 0) {
    throw new Error("keys is required");
  }
  if (value.length > MAX_KEYS_PER_SEND) {
    throw new Error(`at most ${MAX_KEYS_PER_SEND} keys per send`);
  }
  return value.map((name) => {
    if (!isTerminalKeyName(name)) {
      throw new Error(`unknown key ${JSON.stringify(name)} — allowed: ${TERMINAL_KEY_NAMES.join(", ")}`);
    }
    return name;
  });
};
