// Which cells of the server's copy of the layout (#3427) a grid that loaded empty is offered back.
import { parseGridState, type Cell, type GridState } from "./gridTabs";

export type OfferedCell = Omit<Cell, "uid">;

/** Read the copy the way the browser's own copy is read, then leave out what is already on screen:
 *  a cell here, or a session another tab is showing (taking it would fight that tab over it). */
export function cellsToOffer(layout: unknown, openSessionIds: readonly string[], attachedElsewhere: readonly string[]): OfferedCell[] {
  if (layout === null || layout === undefined) return [];
  const saved = parseGridState(JSON.stringify(layout));
  const shown = new Set([...openSessionIds, ...attachedElsewhere]);
  return (saved?.cells ?? []).filter((cell) => cell.session !== null && !shown.has(cell.session)).map(({ uid: _uid, ...cell }) => cell);
}

export const sessionIdsOf = (state: GridState): string[] => state.cells.map((cell) => cell.session).filter((id): id is string => id !== null);
