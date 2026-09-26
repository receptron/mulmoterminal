// Which grid action a key event means, decided without touching the DOM so the rules are
// unit-testable on their own (same shape as `enterKeyOverride` in common/terminalSubmit.ts).
//
// The key->action mapping itself is the user's, from `keymap` in config.json — see
// common/keymap.ts. Nothing is bound by default, so an unconfigured install never takes a
// key away from the terminal.
//
// An un-zoomed grid DOES have a selection — the cell holding the cursor — so the actions split in
// two by the state they need: those acting on the enlarged terminal, and those walking the tiled
// grid. Each declines in the other state rather than guessing; the lists are in common/keymap.ts.
import { actionForKey, NEEDS_A_CURRENT_TERMINAL, NEEDS_NOTHING_ENLARGED, TERMINAL_SCOPED_ACTIONS, type Keymap, type KeymapAction } from "../../common/keymap";

export type GridShortcut = KeymapAction;

// The structural shape of a keydown these rules need. A real KeyboardEvent satisfies it, and
// so does a plain test object — no DOM dependency.
export interface ShortcutKeyEvent {
  type: string;
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

export function gridShortcutFor(keymap: Keymap, e: ShortcutKeyEvent, zoomed: boolean): GridShortcut | null {
  if (e.type !== "keydown") return null;
  // An IME candidate list uses keys like PageUp/PageDown to page through candidates; that
  // keystroke belongs to the composition, never to us.
  if (e.isComposing) return null;
  const action = actionForKey(keymap, e);
  return action === null ? null : gateShortcut(action, zoomed);
}

/** Whether the grid acts on `action` in this view state — the second half of `gridShortcutFor`,
 *  shared with a sequence's action, which is resolved without a single keystroke to match. */
export function gateShortcut(action: KeymapAction, zoomed: boolean): GridShortcut | null {
  // Terminal-scoped actions are decided inside the terminal (common/terminalClipboard.ts) and
  // must never reach this handler, which ends every match with preventDefault() — fatal for
  // `paste`, whose whole mechanism is the browser's own default action.
  if (TERMINAL_SCOPED_ACTIONS.includes(action)) return null;
  // The two state conditions are mirrors: one acts on the enlarged terminal, the other walks the
  // tiled grid. Whichever does not apply DECLINES the key — returning null leaves the event alive,
  // so a `send` bound to the same keystroke fires in that state (see common/keymap.ts).
  if (NEEDS_A_CURRENT_TERMINAL.includes(action)) return zoomed ? action : null;
  if (NEEDS_NOTHING_ENLARGED.includes(action)) return zoomed ? null : action;
  return action;
}

// Whether the keystroke is being typed into a form field and so must be left alone.
//
// The trap: xterm's own input surface IS a <textarea> (class `xterm-helper-textarea`), so a
// plain "ignore INPUT/TEXTAREA/SELECT" rule would ignore the terminal itself — the one place
// the shortcut has to work.
const EDITABLE_TAGS = ["INPUT", "TEXTAREA", "SELECT"];
const XTERM_INPUT_CLASS = "xterm-helper-textarea";

export function isEditableTarget(tagName: string, classNames: readonly string[]): boolean {
  if (classNames.includes(XTERM_INPUT_CLASS)) return false;
  return EDITABLE_TAGS.includes(tagName.toUpperCase());
}
