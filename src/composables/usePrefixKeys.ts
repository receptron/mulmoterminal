// The wait between the two keys of a sequence (#2265): what is pending, and when it lapses. The
// decisions are prefixStep's; this holds the state it decides from and clears it on time, so the
// hint goes away without another key being pressed.
import { onBeforeUnmount, shallowRef, type ShallowRef } from "vue";
import type { Keymap } from "../../common/keymap";
import { gateShortcut, gridShortcutFor, type GridShortcut, type ShortcutKeyEvent } from "./gridShortcut";
import { PREFIX_KEY_TIMEOUT_MS, prefixStep, type PendingPrefix, type PrefixStep } from "./prefixKeys";

export interface PrefixKeys {
  pending: ShallowRef<PendingPrefix | null>;
  /** Take one keydown through the sequence: starts, resolves or ends the wait. */
  handle: (keymap: Keymap, e: ShortcutKeyEvent) => PrefixStep;
  /** The grid shortcut this keydown runs; null when it is claimed with nothing to run (a
   *  sequence's first key, a cancelled one, one that declines in this view state); undefined
   *  when it is not the grid's at all. */
  shortcutFor: (keymap: Keymap, e: ShortcutKeyEvent, zoomed: boolean) => GridShortcut | null | undefined;
  /** End a wait without acting — the grid is giving the keyboard to something else. */
  cancel: () => void;
  /** `shortcutFor`, and a key the grid claims is stopped here so it never reaches the terminal. */
  claim: (keymap: Keymap, e: ShortcutKeyEvent & ClaimableEvent, zoomed: boolean) => GridShortcut | null;
}

interface ClaimableEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
}

export function usePrefixKeys(now_ms: () => number = Date.now): PrefixKeys {
  const pending = shallowRef<PendingPrefix | null>(null);
  let lapse: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => {
    if (lapse !== null) clearTimeout(lapse);
    lapse = null;
    pending.value = null;
  };
  const handle = (keymap: Keymap, e: ShortcutKeyEvent): PrefixStep => {
    const step = prefixStep(keymap, pending.value, e, now_ms());
    if (step.kind === "ignore") return step;
    clear();
    if (step.kind === "wait") {
      pending.value = step.pending;
      lapse = setTimeout(clear, PREFIX_KEY_TIMEOUT_MS);
    }
    return step;
  };
  // A keystroke bound on its own wins over starting a sequence — the config check warns when a
  // sequence's first key is taken that way — and while a sequence waits, the next key is its.
  const shortcutFor = (keymap: Keymap, e: ShortcutKeyEvent, zoomed: boolean): GridShortcut | null | undefined => {
    const single = pending.value === null ? gridShortcutFor(keymap, e, zoomed) : null;
    if (single) return single;
    const step = handle(keymap, e);
    if (step.kind === "pass" || step.kind === "ignore") return undefined;
    return step.kind === "run" ? gateShortcut(step.action, zoomed) : null;
  };
  const claim = (keymap: Keymap, e: ShortcutKeyEvent & ClaimableEvent, zoomed: boolean): GridShortcut | null => {
    const shortcut = shortcutFor(keymap, e, zoomed);
    if (shortcut === undefined) return null;
    e.preventDefault();
    e.stopPropagation();
    return shortcut;
  };
  onBeforeUnmount(clear);
  return { pending, handle, shortcutFor, cancel: clear, claim };
}
