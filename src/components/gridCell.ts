// What the grid requires of any cell, whichever kind it is.
//
// Three cell types render in the same grid — a Claude session, a script run, a configured
// launcher — and GridView drives all three identically: it expands one, reorders them, and
// sorts by the attention each reports. That contract belongs to the GRID, not to any cell,
// and it was written out three times with the same comments attached (#646 B1).
//
// Named once so a fourth cell type gets it by construction rather than by copying, and so a
// change to what the grid needs cannot land in two of the three.
import type { CellStatus } from "./gridTabs";

export interface GridCellProps {
  expanded: boolean;
  // True while SOME cell in the grid is zoomed → this cell is a filmstrip thumbnail
  // (unless it's the zoomed one). Only then does a header-background click zoom it.
  zoomed?: boolean;
  home: string | null;
}

export interface GridCellEmits {
  (e: "toggle-expand" | "close"): void;
  // Swap this cell left (-1) or right (+1) in manual sort mode.
  (e: "move", dir: -1 | 1): void;
  // Report activity up so the grid can attention-sort in auto mode.
  (e: "status", value: CellStatus): void;
}
