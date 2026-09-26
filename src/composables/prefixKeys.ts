// A two-keystroke binding, resolved (#2265): the first key starts a short wait, and the next key
// picks the action — tmux's prefix, or Emacs's `C-x b`. Decided without touching the DOM or the
// clock, so every step is a spec; the wait itself lives in usePrefixKeys.
import { matchesBinding, sequenceBindings, type Keymap, type KeymapAction, type SequenceBinding } from "../../common/keymap";
import type { ShortcutKeyEvent } from "./gridShortcut";

/** How long the first key waits for the second. Long enough to read the hint, short enough that a
 *  forgotten prefix does not swallow a key typed much later. */
export const PREFIX_KEY_TIMEOUT_MS = 3000;

/** A first key that has been pressed, and what can follow it. */
export interface PendingPrefix {
  candidates: SequenceBinding[];
  firstLabel: string;
  startedAt_ms: number;
}

/** What the grid does with this keydown. Every kind but `pass` and `ignore` claims the key, so it
 *  never reaches the terminal — the prefix, the key that follows it, and the Esc that cancels. */
export type PrefixStep =
  { kind: "pass" } | { kind: "ignore" } | { kind: "wait"; pending: PendingPrefix } | { kind: "run"; action: KeymapAction } | { kind: "cancel" };

// Pressed on their own on the way to a second key such as Shift+P; they must not end the wait.
const MODIFIER_KEYS = ["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "Fn", "OS"];

export function prefixStep(keymap: Keymap, pending: PendingPrefix | null, e: ShortcutKeyEvent, now_ms: number): PrefixStep {
  if (e.type !== "keydown" || e.isComposing) return { kind: "pass" };
  const live = pending !== null && now_ms - pending.startedAt_ms < PREFIX_KEY_TIMEOUT_MS ? pending : null;
  return live ? secondKey(live, e) : firstKey(keymap, e, now_ms);
}

function firstKey(keymap: Keymap, e: ShortcutKeyEvent, now_ms: number): PrefixStep {
  const candidates = sequenceBindings(keymap).filter((binding) => matchesBinding(binding.first, e));
  const [head] = candidates;
  return head ? { kind: "wait", pending: { candidates, firstLabel: head.firstLabel, startedAt_ms: now_ms } } : { kind: "pass" };
}

// A key the sequence does not know ends the wait AND is claimed, as after tmux's prefix: typed a
// moment after the prefix, it was meant for the grid, not for the terminal.
function secondKey(pending: PendingPrefix, e: ShortcutKeyEvent): PrefixStep {
  if (MODIFIER_KEYS.includes(e.key)) return { kind: "ignore" };
  const match = pending.candidates.find((binding) => matchesBinding(binding.second, e));
  return match ? { kind: "run", action: match.action } : { kind: "cancel" };
}
