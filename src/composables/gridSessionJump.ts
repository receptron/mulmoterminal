// Going to a grid cell by its SESSION, from a screen that only knows session ids (the GitHub board,
// #3172). The grid registers it while mounted, like the palette's terminal rows; with no grid there
// is nowhere to go, and the board shows the cell without a jump.
import { onBeforeUnmount, onMounted, shallowRef, type Ref } from "vue";
import { router } from "../router";
import type { GridState } from "../components/gridTabs";

export interface GridSessionJump {
  has: (session: string) => boolean;
  goTo: (session: string) => void;
  /** By slot key (`cell-<uid>`), for a caller holding a terminal connection rather than a session. */
  goToSlot: (key: string) => void;
}

export const gridSessionJump = shallowRef<GridSessionJump | null>(null);

const CELL_KEY_PREFIX = "cell-";

const uidOf = (state: GridState, session: string): number | null => state.cells.find((cell) => cell.session === session)?.uid ?? null;

/** Registered by the grid. `jumpToTerminal` is the grid's own move to a cell by uid. */
export function useGridSessionJump(state: Ref<GridState>, jumpToTerminal: (uid: number) => void): void {
  const jump: GridSessionJump = {
    has: (session) => uidOf(state.value, session) !== null,
    goTo: (session) => {
      const uid = uidOf(state.value, session);
      if (uid === null) return;
      if (router.currentRoute.value.name !== "terminals") void router.push("/terminals");
      jumpToTerminal(uid);
    },
    goToSlot: (key) => {
      const uid = Number(key.slice(CELL_KEY_PREFIX.length));
      if (key.startsWith(CELL_KEY_PREFIX) && Number.isInteger(uid)) jumpToTerminal(uid);
    },
  };
  onMounted(() => (gridSessionJump.value = jump));
  onBeforeUnmount(() => {
    if (gridSessionJump.value === jump) gridSessionJump.value = null;
  });
}
