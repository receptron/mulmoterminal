// Where a clicked terminal path meets the Files pane. The link provider is registered per
// terminal connection, deep in useTerminalConnections; the pane belongs to TerminalGrid,
// which alone knows what is zoomed and whether the pane is open. A module singleton is how
// the two other cross-cutting terminal settings already meet their consumers (activeKeymap,
// copyOnSelect) — the alternative is threading a prop through every cell component.
//
// The opener answers whether it TOOK the click, so the caller can fall back to the route the
// path had before rather than swallowing it. TerminalGrid owns the guards about ITS state
// (what is zoomed, where the pane is rooted); tryOpenInPane below owns the two that are about
// the path itself.
import { isPaneViewable } from "./terminalFilePathLinkProvider";
import { pathWithinCwd, rebaseOutsideCwd } from "./pathWithinCwd";
import type { FileLocation } from "./filePathLocation";
import { joinedPath, openGrantedTab, requestFileGrant } from "./grantedTab";
import { grantKind } from "../../common/fileGrant";
import { i18n } from "../i18n";

/** Show `pathRel` (relative to `cwd`) in the pane, at `location` when one was named, in a new tab when
 *  `newTab`. `session` is the cell the click came from — on the tiled grid, the cell the pane opens
 *  beside (#3238); null for a terminal with no session yet. False = not handled, use the old route. */
export type FilesPaneOpener = (cwd: string, pathRel: string, location: FileLocation | undefined, newTab: boolean, session: string | null) => boolean;

let opener: FilesPaneOpener | null = null;

/** TerminalGrid registers on mount and clears on unmount — a stale opener would point at a
 *  pane that no longer exists, and report success for a click nothing acted on. */
export function setFilesPaneOpener(fn: FilesPaneOpener | null): void {
  opener = fn;
}

export function openInFilesPane(cwd: string, pathRel: string, location: FileLocation | undefined, newTab: boolean, session: string | null): boolean {
  return opener?.(cwd, pathRel, location, newTab, session) ?? false;
}

/** First chance at a path clicked in terminal output: the grid's right pane, when it can show
 *  that kind of file. A file under the directory of the cell the pane belongs to is handed over
 *  relative to it; one outside is handed over by its absolute path, which the pane shows on its own
 *  (#3238) — unless a tab shows it better: a page, a picture, a PDF or media outside the cell keeps
 *  the one-file grant, since the pane draws those from routes that serve only served directories.
 *  False sends the click down the route it had before — a new tab, or the full-screen view. */
export function tryOpenInPane(filePath: string, cwd: string, location: FileLocation | undefined, newTab: boolean, session: string | null): boolean {
  if (!isPaneViewable(filePath)) return false;
  const pathRel = pathWithinCwd(filePath, cwd);
  if (pathRel !== null) return openInFilesPane(cwd, pathRel, location, newTab, session);
  const outside = rebaseOutsideCwd(filePath, cwd);
  if (outside === null || grantKind(outside.rel) !== null) return false;
  return openInFilesPane(cwd, joinedPath(outside.base, outside.rel), location, newTab, session);
}

/** A clicked file outside the cell that a tab shows: opened in one, through a one-file URL. */
export function openOutsideFile(absPath: string): void {
  void openGrantedTab(absPath, {
    openBlank: () => window.open("", "_blank"),
    requestGrant: requestFileGrant,
    problemText: (reason, path) => i18n.global.t(`outsideFile.${reason}`, { path }),
    origin: window.location.origin,
  });
}
