// What the right-click menu on a printed path can do (#3238), as functions of the link and of
// what the app offers — so the menu component is template and the decisions are testable.
//
// "Open in the pane" is what a click does: the pane first, the route after it declines. "Open in a
// new tab" is the route without the pane, and for a source file — which a click sends to the
// in-app Files view — that view in a tab of its own. "Open in the Files view" is that view in this
// tab. "Copy the path" is the absolute path, which is what a prompt or an issue wants.
import { fileLinkTarget, openLinkByRoute, resolveLinkPath, type LinkRouteDeps } from "./terminalFilePathLinkProvider";
import { isWindowsRoot } from "./pathWithinCwd";
import { joinedPath } from "./grantedTab";
import { grantKind } from "../../common/fileGrant";
import { locationQuery, type FileLocation } from "./filePathLocation";
import type { HoveredLink, LinkMenuRequest } from "./terminalLinkMenu";

export interface LinkActionDeps extends LinkRouteDeps {
  openInPane: (filePath: string, cwd: string, location: FileLocation | undefined, newTab: boolean, session: string | null) => boolean;
}

export function openLinkInPane(link: LinkMenuRequest, deps: LinkActionDeps): void {
  if (deps.openInPane(link.text, link.cwd, link.location, false, link.session)) return;
  openLinkByRoute(link.text, link.cwd, link.location, deps);
}

/** The Files view's own URL for a file, the way `filesGotoFile` addresses it — by query, so a name
 *  with any character in it (a `\` on a POSIX cwd included) rides encoded rather than as a path
 *  segment a route would refuse. */
export const filesViewUrl = (cwd: string, pathRel: string, location: FileLocation | undefined): string =>
  `/files?${new URLSearchParams({ cwd, path: pathRel, ...locationQuery(location) }).toString()}`;

export function openLinkInTab(link: HoveredLink, deps: LinkRouteDeps): void {
  const { base, rel, outside } = resolveLinkPath(link.text, link.cwd);
  if (outside && grantKind(rel) !== null) {
    deps.openOutside(joinedPath(base, rel));
    return;
  }
  const target = fileLinkTarget(rel, base);
  deps.openUrl(target.kind === "url" ? target.url : filesViewUrl(base, rel, link.location));
}

export function openLinkInFiles(link: HoveredLink, deps: LinkRouteDeps): void {
  const { base, rel } = resolveLinkPath(link.text, link.cwd);
  deps.openInFiles(rel, base, link.location);
}

const POSIX_ABSOLUTE = /^[/~]/;
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const WINDOWS_SEPARATORS = /[\\/]/;

/** Segments as a filesystem resolves them: a `.` is nothing, a `..` climbs — never above the root,
 *  which is the first segment (empty for `/`, the drive for `C:`). */
function resolvedSegments(parts: string[]): string[] {
  return parts.reduce<string[]>((out, segment, index) => {
    if (index === 0) return [segment];
    if (segment === "" || segment === ".") return out;
    if (segment === "..") return out.length > 1 ? out.slice(0, -1) : out;
    return [...out, segment];
  }, []);
}

/** The path as a prompt or an issue wants it: absolute, `.` and `..` resolved, in the separator the
 *  cell prints (#3236). In a Windows cell both separators are read and `\` is written, since there a
 *  `\` cannot be part of a name; on any other root only `/` separates, so a `\` printed in a name
 *  stays one. A printed absolute path is itself. */
export function absolutePathOf(text: string, cwd: string): string {
  if (POSIX_ABSOLUTE.test(text) || WINDOWS_ABSOLUTE.test(text)) return text;
  const windows = isWindowsRoot(cwd);
  const split = (path: string): string[] => path.split(windows ? WINDOWS_SEPARATORS : "/");
  return resolvedSegments([...split(cwd), ...split(text)]).join(windows ? "\\" : "/");
}
