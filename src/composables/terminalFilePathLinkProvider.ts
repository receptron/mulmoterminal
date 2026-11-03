// Turns file paths in xterm terminal output into clickable links, scoped to the session's
// cwd. WHAT a click opens is chosen by extension (ROUTE_BY_EXTENSION / IN_APP_EXTENSIONS
// below) — the raw route is only the fallback. Registered next to WebLinksAddon, which
// handles http/https URLs.
//
// ── DOCS ──────────────────────────────────────────────────────────────────────────────
// That routing is a documented, user-facing spec. Change or extend it and update all
// three in the same commit — they went stale together once and stayed wrong for a
// release (#834):
//   1. README.md — "Clicking a file path" (the canonical table)
//   2. docs/guide/en/features.md + docs/guide/ja/features.md — the file-path row, BOTH
//   3. docs/terminal-notes.md — the link-mechanisms table
// ──────────────────────────────────────────────────────────────────────────────────────
//
// The pure core (computeFilePathLinks) maps a row of terminal cells to link ranges in
// 1-based inclusive columns — accounting for wide (CJK) glyphs that occupy two columns —
// so the string ranges from findFilePathLinks land on the right cells.
import type { Terminal, ILinkProvider, ILink } from "@xterm/xterm";
import { SOURCE_CODE_EXTENSIONS } from "../../common/sourceExtensions";
import { browserDisplays } from "../../common/rawContentType";
import { findFilePathLinks, type FilePathLinkOptions } from "./terminalFilePathLinks";
import type { FileLocation } from "./filePathLocation";
import { isWindowsRoot, pathWithinCwd, rebaseOutsideCwd } from "./pathWithinCwd";
import { joinedPath } from "./grantedTab";
import { grantKind } from "../../common/fileGrant";
import { fileMediaKind, filePreviewKind } from "../components/filePreviewKind";
import { HTML_FILE_NAME, filesPageUrl } from "../../common/filesPage";
import { wantsNewTab } from "./newTabModifier";
import type { HoveredLink } from "./terminalLinkMenu";

export interface TerminalCell {
  chars: string;
  width: number;
}

export interface ColumnLink {
  text: string;
  startX: number; // 1-based, inclusive
  endX: number; // 1-based, inclusive
  location?: FileLocation;
}

// Wide glyphs occupy two columns (a width-2 cell followed by a width-0 continuation cell);
// map every UTF-16 unit to the column it starts and ends in, then linkify the joined text.
export function computeFilePathLinks(cells: TerminalCell[], options: FilePathLinkOptions = {}): ColumnLink[] {
  const units: string[] = [];
  const colStart: number[] = [];
  const colEnd: number[] = [];
  for (let col = 0; col < cells.length; col++) {
    const cell = cells[col];
    if (!cell || cell.width === 0) continue; // absent, or the trailing half of a wide glyph
    const chars = cell.chars.length ? cell.chars : " "; // an unwritten cell renders as a space
    for (let k = 0; k < chars.length; k++) {
      units.push(chars[k] ?? "");
      colStart.push(col);
      colEnd.push(col + cell.width - 1);
    }
  }
  return findFilePathLinks(units.join(""), options).map((hit) => ({
    text: hit.text,
    startX: (colStart[hit.start] ?? 0) + 1,
    endX: (colEnd[hit.end - 1] ?? 0) + 1,
    ...(hit.location ? { location: hit.location } : {}),
  }));
}

// Which route opens a clicked path, by extension. A file the browser can only show as
// SOURCE goes to the raw route; one we can present better gets its own. Kept as a table so
// the next extension is a row rather than a branch (#808).
//
// The markdown route is what the Files overlay already previews with — same `cwd`/`path`
// query, marked-rendered, served under a sandbox CSP. It resolves its base slightly more
// loosely than the raw route (any existing absolute dir, vs. the raw route's "root or a live
// session cwd"), which is the browse routes' documented posture; the cwd handed over here is
// the session's own either way.
const ROUTE_BY_EXTENSION: Record<string, string> = {
  ".md": "/api/files/browse/md",
  ".markdown": "/api/files/browse/md",
  ".json": "/api/files/browse/json",
  ".csv": "/api/files/browse/table",
  ".tsv": "/api/files/browse/table",
};

const RAW_ROUTE = "/api/files/raw";
const MAIN_BUTTON = 0;

// Source: nothing a browser tab can do with it beyond showing the bytes, which is what the
// app's own Files view does better — CodeMirror highlights it, the tree is right there, and
// it can be edited (#808).
//
// The shared source set plus `.txt`. Prose (`.md` and friends) is deliberately absent — it
// has its own rendered route in ROUTE_BY_EXTENSION — and so is `.html`, which opens as a rendered
// page (`htmlPageUrl`).
const IN_APP_EXTENSIONS = new Set<string>([...SOURCE_CODE_EXTENSIONS, ".txt"]);

/** How a clicked path opens: in the app's own Files view, or at a URL in a new tab. */
export type FileLinkTarget = { kind: "files" } | { kind: "url"; url: string };

/** A path's extension, lower-cased — `README.MD` is still markdown, and a `.md` in the
 *  middle of a name is not an extension. Empty when there is none. */
export function fileExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot === -1 ? "" : filePath.slice(dot).toLowerCase();
}

/** The route a path's extension is opened through. */
export function fileViewerRoute(filePath: string): string {
  return ROUTE_BY_EXTENSION[fileExtension(filePath)] ?? RAW_ROUTE;
}

/** An HTML file's URL on the page route, which renders it rather than showing its source — or null
 *  for a path that is not one, or that the route cannot address because it is not under `cwd`. A
 *  backslash is left to the raw route: `pathWithinCwd` reads it as a separator, which on POSIX would
 *  address a different file than the one clicked. */
function htmlPageUrl(filePath: string, cwd: string): string | null {
  if (!HTML_FILE_NAME.test(filePath) || filePath.includes("\\")) return null;
  const pathRel = pathWithinCwd(filePath, cwd);
  return pathRel === null ? null : filesPageUrl(cwd, pathRel);
}

export function fileLinkTarget(filePath: string, cwd: string): FileLinkTarget {
  const ext = fileExtension(filePath);
  if (IN_APP_EXTENSIONS.has(ext)) return { kind: "files" };
  const pageUrl = htmlPageUrl(filePath, cwd);
  if (pageUrl !== null) return { kind: "url", url: pageUrl };
  // A type with a rendered route of its own goes there, and that outranks the question below —
  // `.tsv` has the table route but no MIME the raw route knows, so asking "would a browser
  // display this" first would send it to the pane while its sibling `.csv` opened as a table
  // (CodeRabbit on #2038).
  if (ROUTE_BY_EXTENSION[ext] !== undefined) return { kind: "url", url: rawFileUrl(filePath, cwd) };
  // Otherwise: a tab that cannot display the file does not show it — it downloads it, with no
  // warning and no choice (#2038). The app's own view is the better answer there even though it
  // cannot render it either: it names the file and offers to open it in the app that owns it.
  if (!browserDisplays(filePath)) return { kind: "files" };
  return { kind: "url", url: rawFileUrl(filePath, cwd) };
}

/** Whether the grid's Files pane can show this path: anything the app renders
 *  as text or as Markdown, an HTML page, an image, a PDF, a video or a sound. Derived from the
 *  tables above rather than being another one, so a new extension row reaches the pane without a
 *  second edit. With no pane open the click still goes to a tab. */
export function isPaneViewable(filePath: string): boolean {
  const ext = fileExtension(filePath);
  // Indexed like fileViewerRoute does, not `in`: the table is a plain object, so `in` also
  // answers for whatever Object.prototype carries. Every real key starts with a dot and no
  // inherited one does, which makes it safe today and needlessly load-bearing tomorrow.
  if (IN_APP_EXTENSIONS.has(ext) || ROUTE_BY_EXTENSION[ext] !== undefined) return true;
  // What the pane now shows beside its text (#2269): an HTML page or an SVG in its Preview, and a
  // picture, PDF, video or sound where it would have said "not text" (#2674). A chart an agent just
  // wrote stays in the grid rather than leaving it for a browser tab.
  if (filePreviewKind(filePath) !== null || fileMediaKind(filePath) !== null) return true;
  // And anything a TAB cannot display, because there the tab is not a view — it is a download
  // starting with no warning, which is the half of #2038 the user actually notices. The pane can
  // at least name the file and offer to open it in the app that owns it. Asked of the same table
  // the raw route answers `Content-Type` from, so the two cannot disagree about which types
  // those are (common/rawContentType.ts).
  return !browserDisplays(filePath);
}

export function rawFileUrl(filePath: string, cwd: string): string {
  return `${fileViewerRoute(filePath)}?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(filePath)}`;
}

/** Where a printed path resolves for the routes: the base they may be handed and the path under
 *  it. A path outside the cell is served relative to its own directory — the routes contain
 *  `path` within `cwd`, so handing them the cell's cwd refused it as an escape (#2260). */
const PRINTED_ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/])/;

export function resolveLinkPath(text: string, cwd: string): { base: string; rel: string; outside: boolean } {
  const rebased = rebaseOutsideCwd(text, cwd);
  if (rebased) return { base: rebased.base, rel: rebased.rel, outside: true };
  // A root file printed ABSOLUTE goes over relative to the root: a tab path's shape says whether the
  // file is outside the root (#3238), so a root file must never arrive absolute. One printed relative
  // goes as printed — folding it would read a `\` in a POSIX name as a separator.
  const rel = PRINTED_ABSOLUTE.test(text) ? (pathWithinCwd(text, cwd) ?? text) : text;
  return { base: cwd, rel, outside: false };
}

export interface LinkRouteDeps {
  openUrl: (url: string) => void;
  openInFiles: (filePath: string, cwd: string, location?: FileLocation) => void;
  /** A file outside the cell that a tab shows gets a one-file URL from the server first (#3024):
   *  the raw route refuses its directory. */
  openOutside: (absPath: string) => void;
}

/** What a click does once the pane has declined it: a tab, through the route for the extension,
 *  or the app's own Files view. Also what the right-click menu's "open in a new tab" starts from. */
export function openLinkByRoute(text: string, cwd: string, location: FileLocation | undefined, deps: LinkRouteDeps): void {
  const { base, rel, outside } = resolveLinkPath(text, cwd);
  if (outside && grantKind(rel) !== null) {
    deps.openOutside(joinedPath(base, rel));
    return;
  }
  const target = fileLinkTarget(rel, base);
  if (target.kind === "files") deps.openInFiles(rel, base, location);
  else deps.openUrl(target.url);
}

function readCells(term: Terminal, bufferLineNumber: number): TerminalCell[] | null {
  const line = term.buffer.active.getLine(bufferLineNumber - 1);
  if (!line) return null;
  const cells: TerminalCell[] = [];
  for (let i = 0; i < line.length; i++) {
    const cell = line.getCell(i);
    cells.push({ chars: cell?.getChars() ?? "", width: cell?.getWidth() ?? 1 });
  }
  return cells;
}

/** What a link does when used, supplied by the host that knows the pane, the router and the menu. */
export interface FileLinkOpeners extends LinkRouteDeps {
  // First chance at the click, ahead of the extension table: the grid's Files pane, which can show
  // most of these WITHOUT leaving the grid (#910). Returns whether it took it; false falls through
  // to the routing, unchanged. `newTab` is Cmd/Ctrl on the click (#3005).
  openInPane: (filePath: string, cwd: string, location: FileLocation | undefined, newTab: boolean) => boolean;
  // Told which link the pointer is over, and when it leaves one: a right-click on the terminal
  // asks this to know what it was over (#3238).
  onHover?: (link: HoveredLink | null) => void;
}

export function createFilePathLinkProvider(term: Terminal, getCwd: () => string | null, openers: FileLinkOpeners): ILinkProvider {
  const { openUrl, openInFiles, openInPane, openOutside } = openers;
  const onHover = openers.onHover ?? (() => {});
  // The link the pointer is over, so that only ITS leave or disposal clears the hover: xterm
  // releases a cached link when the line it is on changes, which may be a link the pointer left
  // long ago.
  let current: HoveredLink | null = null;
  const enter = (link: HoveredLink): void => {
    current = link;
    onHover(link);
  };
  const exit = (link: HoveredLink | null): void => {
    if (link !== null && current !== link) return;
    current = null;
    onHover(null);
  };
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
      const cwd = getCwd();
      const cells = cwd ? readCells(term, bufferLineNumber) : null;
      if (!cwd || !cells) {
        // No links while the cwd is unknown — and none hovered either, whatever was before.
        exit(null);
        return callback(undefined);
      }
      // A Windows cell prints `\`-separated paths; anywhere else `\` can be part of a file name.
      const links: ILink[] = computeFilePathLinks(cells, { windowsPaths: isWindowsRoot(cwd) }).map((link) => {
        const hovered: HoveredLink = { text: link.text, cwd, location: link.location };
        return {
          text: link.text,
          range: { start: { x: link.startX, y: bufferLineNumber }, end: { x: link.endX, y: bufferLineNumber } },
          decorations: { pointerCursor: true, underline: true },
          activate: (event: MouseEvent) => {
            // xterm activates a link on any button's mouseup; a right-click is the menu's (#3238).
            if (event.button !== MAIN_BUTTON) return;
            if (openInPane(link.text, cwd, link.location, wantsNewTab(event))) return;
            openLinkByRoute(link.text, cwd, link.location, { openUrl, openInFiles, openOutside });
          },
          hover: () => enter(hovered),
          leave: () => exit(hovered),
          dispose: () => exit(hovered),
        };
      });
      callback(links.length ? links : undefined);
    },
  };
}
