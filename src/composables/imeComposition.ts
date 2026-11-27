// Whether the key that just arrived is confirming an IME candidate, for the handlers that see a
// keystroke WITHOUT owning the field it was typed into: xterm's custom key handler and the grid's
// window-level shortcut listener.
//
// Those paths already refuse `event.isComposing`, which is correct on Chrome and Firefox. It is not
// enough on Safari, which fires `compositionend` BEFORE the confirming keydown — by then the flag is
// false, and the keystroke that was only meant to accept 変換 gets sent to the pty or run as a
// shortcut (#1353). The tracking that closes that gap needs composition events over time, which a
// pure `(keymap, event)` function cannot see, so it lives here and the call sites ask.
//
// Module-level rather than per-consumer: the two consumers must agree about one composition, and it
// belongs to the document, not to either of them.
import { useImeAwareEnter } from "./useImeAwareEnter";
import { isMetaDuringComposition } from "./composingMeta";

// The Enter callback is unused — this consumer wants only the composition tracking and the
// predicate. Reusing the composable rather than restating the rule keeps ONE definition of "is this
// an IME confirmation", which is the part that is easy to get subtly wrong twice.
const shared = useImeAwareEnter(() => {});

if (typeof window !== "undefined") {
  // Capture, because xterm binds its own listeners on the helper textarea and the grid's shortcut
  // handler already listens in capture — the flag has to be set before either of them reads it.
  window.addEventListener("compositionstart", shared.onCompositionStart, true);
  window.addEventListener("compositionend", shared.onCompositionEnd, true);
  // A composition belongs to whatever element has focus, and `compositionend` is not guaranteed to
  // arrive when that ends some other way — a tab switch, or the input being torn down mid-word.
  // Per-component state would just go away with the component; this one does not, so a flag left
  // set here suppresses EVERY later keystroke: no grid shortcuts and no terminal Enter, until the
  // page is reloaded. That is a worse failure than the one this module exists to prevent.
  //
  // `blur` does not bubble, but a capture-phase listener on `window` still sees an element's blur
  // on the way down, AND the window's own — one listener for both.
  window.addEventListener("blur", shared.onBlur, true);
}

/** True while an IME candidate is open, and for a moment after Safari closes one. */
export const isImeConfirming = (event: KeyboardEvent): boolean => shared.isImeConfirmation(event);

/** What xterm's custom key handler must return for a key the IME owns, or undefined when it owns none. */
export const xtermImeKeyVerdict = (event: KeyboardEvent): boolean | undefined => {
  if (isMetaDuringComposition(event)) return false;
  return isImeConfirming(event) ? true : undefined;
};

/** Drop any composition state, as losing focus does. Exported for specs, which share this module's
 *  state and would otherwise carry a composition from one test into the next. */
export const resetImeComposition = (): void => shared.onBlur();
