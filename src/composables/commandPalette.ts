// The command palette's state (#2266): whether it is open, and who runs what it picks. Module-level
// because the three parties are far apart — the toolbar opens it, the palette itself lists and
// picks, and the grid is the only thing that can run an action — and none of them owns the others.
import { ref, shallowRef } from "vue";
import type { KeymapAction } from "../../common/keymap";

/** The grid's side: run an action, and say whether a terminal is enlarged (for what is disabled). */
export interface PaletteHost {
  run: (action: KeymapAction) => void;
  zoomed: () => boolean;
}

export const paletteOpen = ref(false);
export const paletteHost = shallowRef<PaletteHost | null>(null);

export const openCommandPalette = (): void => {
  paletteOpen.value = true;
};
export const closeCommandPalette = (): void => {
  paletteOpen.value = false;
};

/** Register the grid as the palette's host; returns how to withdraw it. Withdrawing only clears the
 *  host it registered, so a remount that registers first is not undone by the old unmount. */
export function providePaletteHost(host: PaletteHost): () => void {
  paletteHost.value = host;
  return () => {
    if (paletteHost.value === host) paletteHost.value = null;
  };
}
