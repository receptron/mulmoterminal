// How the host's Claude Code / TUI maps received bytes to "submit this prompt" vs
// "insert a newline". The TUI decides from the bytes, and that mapping is environment-
// dependent (Claude Code lets a user rebind it), so the SAME fact has to reach two
// unrelated places: the browser's xterm key handler and the phone remote-view's submit.
// One value, consumed by both, keeps them from drifting apart.
//
//   "cr"      — the standard binding: CR (\r) submits, ESC+CR (\x1b\r, = Alt/Meta+Enter)
//               makes a newline. This is MulmoTerminal's default and unchanged behaviour.
//   "esc-cr"  — the reversed binding some users configure: ESC+CR submits, CR makes a
//               newline.
export const TERMINAL_SUBMIT_MODES = ["cr", "esc-cr"] as const;
export type TerminalSubmitMode = (typeof TERMINAL_SUBMIT_MODES)[number];
export const DEFAULT_TERMINAL_SUBMIT_MODE: TerminalSubmitMode = "cr";

export const isTerminalSubmitMode = (value: unknown): value is TerminalSubmitMode =>
  typeof value === "string" && (TERMINAL_SUBMIT_MODES as readonly string[]).includes(value);

// CR on its own. ESC+CR is what a terminal emits for Alt/Meta+Enter.
const CR = "\r";
const ESC_CR = "\x1b\r";

// The byte(s) the host reads as "submit this prompt" in the given mode.
export const submitSequence = (mode: TerminalSubmitMode): string => (mode === "esc-cr" ? ESC_CR : CR);
// The byte(s) it reads as "insert a newline" — the other one.
export const newlineSequence = (mode: TerminalSubmitMode): string => (mode === "esc-cr" ? CR : ESC_CR);

// The structural shape of a keydown the override needs. A real DOM KeyboardEvent satisfies
// it, and so does a plain test object — no DOM dependency, so this stays testable and shared.
export interface EnterKeyEvent {
  type: string;
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

// The bytes to emit for an Enter-family keydown (the caller then suppresses xterm's own
// \r and sends these instead), or null to let xterm handle the key natively.
//
// The SEMANTICS are the same in both modes — a bare Enter SUBMITS, Shift/Alt(Option)+Enter
// make a NEWLINE — only which bytes carry each meaning differs, because that is the
// environment fact `mode` encodes.
//
// In "cr" mode only Shift+Enter is overridden, exactly as before the setting existed: a
// bare Enter falls through to xterm's native \r (submit) and Option+Enter to
// macOptionIsMeta's ESC+CR (newline). Leaving the bare-Enter path native keeps IME
// candidate-confirm and the hottest key untouched in the default configuration.
export const enterKeyOverride = (mode: TerminalSubmitMode, e: EnterKeyEvent): string | null => {
  if (e.type !== "keydown" || e.key !== "Enter") return null;
  // IME composition (Japanese and other CJK input): this Enter confirms a candidate — it
  // is never the user's submit/newline, so never intercept it.
  if (e.isComposing) return null;
  const bare = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
  const shiftOnly = e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
  const altHeld = e.altKey && !e.ctrlKey && !e.metaKey; // Option/Alt (with or without Shift)
  if (mode === "cr") return shiftOnly ? newlineSequence(mode) : null;
  // "esc-cr": a bare Enter must emit the ESC+CR that submits here; Shift/Alt+Enter must
  // emit the CR that makes a newline (the Alt case also overrides macOptionIsMeta's ESC+CR).
  if (bare) return submitSequence(mode);
  if (shiftOnly || altHeld) return newlineSequence(mode);
  return null;
};
