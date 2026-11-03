// The menu a right-click on a path in terminal output opens (#3238). The link provider is
// registered per terminal connection, deep in useTerminalConnections; the menu is one component
// mounted once in App.vue. A module ref is how the two meet — the way filesPaneOpener.ts joins a
// click to the grid's pane — rather than a prop threaded through every cell.
import { shallowRef } from "vue";
import type { FileLocation } from "./filePathLocation";
import type { MenuPoint } from "../components/rowMenu";

/** A path printed in a terminal, as the link provider read it. */
export interface HoveredLink {
  /** The path as printed. */
  text: string;
  /** The directory the terminal's session runs in, which the path is read against. */
  cwd: string;
  /** The line (and column) printed after the path, when one was. */
  location: FileLocation | undefined;
}

export interface LinkMenuRequest extends HoveredLink {
  /** The cell the terminal belongs to, which "open in the pane" opens beside on the tiled grid
   *  (#3238); null for a terminal with no session yet. */
  session: string | null;
  /** Where the pointer was: the menu opens there. */
  point: MenuPoint;
}

export const linkMenuRequest = shallowRef<LinkMenuRequest | null>(null);

export function requestLinkMenu(request: LinkMenuRequest): void {
  linkMenuRequest.value = request;
}

export function closeLinkMenu(): void {
  linkMenuRequest.value = null;
}
