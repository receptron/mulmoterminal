// The grid's keyboard, and the command palette's way into it (#2266): single keys and two-key
// sequences through usePrefixKeys, and an action picked in the palette through the same gate a key
// goes through. `command-palette` is handled here rather than by the grid, because what it opens
// belongs to the app, not to a cell.
import { onBeforeUnmount, onMounted, type Ref } from "vue";
import type { Keymap, KeymapAction } from "../../common/keymap";
import { gateShortcut, isEditableTarget, type GridKeyState, type GridShortcut } from "./gridShortcut";
import { isImeConfirming } from "./imeComposition";
import { openCommandPalette, providePaletteHost } from "./commandPalette";
import { runFocusMode } from "./focusMode";
import { runAppAction } from "./runAppAction";
import { isAppAction } from "../../common/appActions";
import { usePrefixKeys, type PrefixKeys } from "./usePrefixKeys";

export interface GridKeys {
  pending: PrefixKeys["pending"];
  cancel: () => void;
  /** Take one keydown: claim it if it is the grid's, and run what it names. A key the grid yields
   *  (see keyYieldsToPage) also drops a sequence waiting for its second key, or that wait would
   *  swallow the next key once the grid has the keyboard back (#2265). */
  onKey: (keymap: Keymap, e: KeyboardEvent) => void;
}

// The checks about the key itself; the host's `available` is the ones about the grid. A key
// confirming an IME candidate is the IME's, not a shortcut: `gridShortcutFor` already refuses `e.isComposing`, and
// this is the Safari case, where compositionend fires first and the flag is already false (#1353).
export function keyYieldsToPage(e: KeyboardEvent): boolean {
  const target = e.target instanceof HTMLElement ? e.target : null;
  return (target !== null && isEditableTarget(target.tagName, Array.from(target.classList))) || isImeConfirming(e);
}

export function useGridKeys(
  run: (shortcut: GridShortcut) => void,
  zoomed: () => boolean,
  available: () => boolean,
  manualOrder: Readonly<Ref<boolean>>,
  filesOpen: () => boolean,
): GridKeys {
  const prefix = usePrefixKeys();
  const keyState = (): GridKeyState => ({ zoomed: zoomed(), manualOrder: manualOrder.value });
  const runAction = (action: KeymapAction): void => {
    if (action === "command-palette") return openCommandPalette();
    // The app's, like the palette: full screen is the page's, not a cell's (#2580).
    if (action === "focus-mode") return void runFocusMode();
    if (isAppAction(action)) {
      runAppAction(action);
      return;
    }
    const shortcut = gateShortcut(action, keyState());
    if (shortcut) run(shortcut);
  };
  let withdraw: (() => void) | null = null;
  onMounted(() => {
    // A pick is refused where the grid would not take the key — the rows already say so, and this is
    // the backstop for a row that was enabled when the list was drawn.
    withdraw = providePaletteHost({
      run: (action) => available() && runAction(action),
      zoomed,
      available,
      manualOrder: () => manualOrder.value,
      filesOpen,
    });
  });
  onBeforeUnmount(() => withdraw?.());
  return {
    pending: prefix.pending,
    cancel: prefix.cancel,
    onKey: (keymap, e) => {
      // In the order the grid always checked: the grid, then the target, then an IME confirmation.
      // A key another handler already took is not the grid's too: an app key run off the grid can
      // put the grid in front before this listener sees it, and a toggle run twice undoes itself.
      if (e.defaultPrevented || !available() || keyYieldsToPage(e)) return prefix.cancel();
      const shortcut = prefix.claim(keymap, e, keyState());
      if (shortcut) runAction(shortcut);
    },
  };
}
