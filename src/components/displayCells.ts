import { pageSlice } from "./gridTabs";

// Which cells the grid actually renders.
//
// Two rules, and they used to be one line in GridView: while a cell is ENLARGED the whole ordered
// list is rendered (the filmstrip and the roster line every tab's terminal up, live); otherwise it
// is the page on screen, at most nine (`docs/grid-view-modes.md`, fact 3).
//
// The third is new (#2001). A chat started from a collection is an ordinary cell, and the pane
// under the collection shows it by having the grid TELEPORT that cell into it — which a cell that
// is not rendered cannot do. So the claimed one is rendered wherever it sits in the paging;
// appended rather than substituted, because the page is what the user arranged and the extra cell
// is invisible behind the overlay that asked for it.

export function cellsToDisplay<T extends { session: string | null }>(
  ordered: readonly T[],
  page: number,
  zoomed: boolean,
  claimedSession: string | null | undefined,
): T[] {
  if (zoomed) return [...ordered];
  const shown = pageSlice([...ordered], page);
  if (!claimedSession || shown.some((cell) => cell.session === claimedSession)) return shown;
  const claimed = ordered.find((cell) => cell.session === claimedSession);
  return claimed ? [...shown, claimed] : shown;
}
