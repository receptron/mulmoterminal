// Opening a recently closed cell again (#2800), from its palette row or from the keymap's
// `terminal-reopen`. Both place it beside the acting terminal and take it off the list.
import { paletteTerminals } from "./commandPalette";
import { cellForClosed, reopenableClosed, type ClosedCell } from "./recentlyClosed";
import { openCellAt } from "./useNewTerminal";
import { forgetClosedCell, recentlyClosed } from "./useRecentlyClosed";
import { configuredRemoteHosts } from "./configuredRemoteHosts";
import { remoteHostStatus } from "../components/remoteHostStatus";

// Asked only for an entry that names a host, so the list is never fetched on a machine without one.
const hostGone = (host: string): boolean => remoteHostStatus(host, configuredRemoteHosts().value) === "gone";

/** The closed cells worth offering: a conversation the grid has open again is not closed any more. */
export const reopenableNow = (): ClosedCell[] => reopenableClosed(recentlyClosed.value, paletteTerminals.value?.openSessionIds() ?? [], hostGone);

export function reopenClosedCell(closed: ClosedCell): void {
  forgetClosedCell(closed);
  const uid = paletteTerminals.value?.current() ?? null;
  openCellAt(cellForClosed(closed), uid === null ? null : `cell-${uid}`);
}

/** Reopen the newest closed cell. False when there is none, or the grid has no room for it — the
 *  entry then stays listed rather than being spent on a cell that is never placed. */
export function reopenLastClosedCell(): boolean {
  const [latest] = reopenableNow();
  if (latest === undefined || paletteTerminals.value?.full()) return false;
  reopenClosedCell(latest);
  return true;
}
