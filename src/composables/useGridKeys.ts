// The grid's keyboard, and the command palette's way into it (#2266): single keys and two-key
// sequences through usePrefixKeys, and an action picked in the palette through the same gate a key
// goes through. `command-palette` is handled here rather than by the grid, because what it opens
// belongs to the app, not to a cell.
import { onBeforeUnmount, onMounted } from "vue";
import type { Keymap, KeymapAction } from "../../common/keymap";
import { gateShortcut, type GridShortcut, type ShortcutKeyEvent } from "./gridShortcut";
import { openCommandPalette, providePaletteHost } from "./commandPalette";
import { usePrefixKeys, type PrefixKeys } from "./usePrefixKeys";

interface ClaimableEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
}

export interface GridKeys {
  pending: PrefixKeys["pending"];
  cancel: () => void;
  /** Take one keydown: claim it if it is the grid's, and run what it names. */
  onKey: (keymap: Keymap, e: ShortcutKeyEvent & ClaimableEvent) => void;
}

export function useGridKeys(run: (shortcut: GridShortcut) => void, zoomed: () => boolean): GridKeys {
  const prefix = usePrefixKeys();
  const runAction = (action: KeymapAction): void => {
    if (action === "command-palette") return openCommandPalette();
    const shortcut = gateShortcut(action, zoomed());
    if (shortcut) run(shortcut);
  };
  let withdraw: (() => void) | null = null;
  onMounted(() => {
    withdraw = providePaletteHost({ run: runAction, zoomed });
  });
  onBeforeUnmount(() => withdraw?.());
  return {
    pending: prefix.pending,
    cancel: prefix.cancel,
    onKey: (keymap, e) => {
      const shortcut = prefix.claim(keymap, e, zoomed());
      if (shortcut) runAction(shortcut);
    },
  };
}
