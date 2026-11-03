// Linkify file paths in the output, scoped to the session's live cwd (read lazily, since
// it's learned after connect). The grid's right pane gets first refusal, so a
// click can land NEXT to the terminal it came from; failing that, a document or an image
// opens in a new tab through the file routes, and source opens in the app's own Files view.
//
// A right-click over a link opens a menu instead (#3238): the provider says which link the
// pointer is over, and the terminal element's `contextmenu` hands that to the one menu the app
// mounts. Off a link the browser's own menu is left alone.
import type { Terminal } from "@xterm/xterm";
import { createFilePathLinkProvider } from "./terminalFilePathLinkProvider";
import { openOutsideFile, tryOpenInPane } from "./filesPaneOpener";
import { filesGotoFile } from "./useFilesView";
import { closeLinkMenu, linkMenuRequest, requestLinkMenu, type HoveredLink, type LinkMenuRequest } from "./terminalLinkMenu";

/** What a terminal's links left behind, to forget when the terminal goes: the hover, and the menu
 *  if it is the one this terminal asked for — never another terminal's. */
const forgetters = new WeakMap<Terminal, () => void>();

export function forgetFilePathLinks(term: Terminal): void {
  forgetters.get(term)?.();
  forgetters.delete(term);
}

export function registerFilePathLinks(term: Terminal, getCwd: () => string | null): void {
  let hovered: HoveredLink | null = null;
  let asked: LinkMenuRequest | null = null;
  forgetters.set(term, () => {
    hovered = null;
    if (asked !== null && linkMenuRequest.value === asked) closeLinkMenu();
    asked = null;
  });
  term.registerLinkProvider(
    createFilePathLinkProvider(term, getCwd, {
      openUrl: (url) => window.open(url, "_blank", "noopener,noreferrer"),
      openInFiles: (filePath, cwd, location) => filesGotoFile(cwd, filePath, location),
      openInPane: (filePath, cwd, location, newTab) => tryOpenInPane(filePath, cwd, location, newTab),
      openOutside: openOutsideFile,
      onHover: (link) => {
        hovered = link;
      },
    }),
  );
  // After term.open(): the element exists only then, and this is called from the wiring that runs
  // once per terminal built.
  term.element?.addEventListener("contextmenu", (event) => {
    if (!hovered) return;
    event.preventDefault();
    asked = { ...hovered, point: { top: event.clientY, left: event.clientX } };
    requestLinkMenu(asked);
  });
}
