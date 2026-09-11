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
import { findFilePathLinks } from "./terminalFilePathLinks";

export interface TerminalCell {
  chars: string;
  width: number;
}

export interface ColumnLink {
  text: string;
  startX: number; // 1-based, inclusive
  endX: number; // 1-based, inclusive
}

// Wide glyphs occupy two columns (a width-2 cell followed by a width-0 continuation cell);
// map every UTF-16 unit to the column it starts and ends in, then linkify the joined text.
export function computeFilePathLinks(cells: TerminalCell[]): ColumnLink[] {
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
  return findFilePathLinks(units.join("")).map((hit) => ({
    text: hit.text,
    startX: (colStart[hit.start] ?? 0) + 1,
    endX: (colEnd[hit.end - 1] ?? 0) + 1,
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

// Source: nothing a browser tab can do with it beyond showing the bytes, which is what the
// app's own Files view does better — CodeMirror highlights it, the tree is right there, and
// it can be edited (#808).
//
// The shared source set plus `.txt`. Prose (`.md` and friends) is deliberately absent — it
// has its own rendered route in ROUTE_BY_EXTENSION — and so is `.html`, which opens at a URL
// so the raw route can serve it under the sandbox CSP.
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

export function fileLinkTarget(filePath: string, cwd: string): FileLinkTarget {
  const ext = fileExtension(filePath);
  if (IN_APP_EXTENSIONS.has(ext)) return { kind: "files" };
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

/** Whether the Files pane beside a zoomed cell can show this path: anything the app renders
 *  as text or as Markdown. Derived from the two tables above rather than being a third one,
 *  so a new extension row reaches the pane without a second edit. What is left out is what
 *  only the raw route can answer — images, PDFs, bytes — where the pane would show an empty
 *  editor and a new tab is still the right place. */
export function isPaneViewable(filePath: string): boolean {
  const ext = fileExtension(filePath);
  // Indexed like fileViewerRoute does, not `in`: the table is a plain object, so `in` also
  // answers for whatever Object.prototype carries. Every real key starts with a dot and no
  // inherited one does, which makes it safe today and needlessly load-bearing tomorrow.
  if (IN_APP_EXTENSIONS.has(ext) || ROUTE_BY_EXTENSION[ext] !== undefined) return true;
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

export function createFilePathLinkProvider(
  term: Terminal,
  getCwd: () => string | null,
  openUrl: (url: string) => void,
  openInFiles: (filePath: string, cwd: string) => void,
  // First chance at the click, ahead of the extension table: the Files pane beside an enlarged
  // cell, which can show most of these WITHOUT leaving the grid (#910). Returns whether it took
  // it; false falls through to the routing below, unchanged.
  openInPane: (filePath: string, cwd: string) => boolean,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
      const cwd = getCwd();
      const cells = cwd ? readCells(term, bufferLineNumber) : null;
      if (!cwd || !cells) return callback(undefined);
      const links: ILink[] = computeFilePathLinks(cells).map((link) => ({
        text: link.text,
        range: { start: { x: link.startX, y: bufferLineNumber }, end: { x: link.endX, y: bufferLineNumber } },
        decorations: { pointerCursor: true, underline: true },
        activate: () => {
          if (openInPane(link.text, cwd)) return;
          const target = fileLinkTarget(link.text, cwd);
          if (target.kind === "files") openInFiles(link.text, cwd);
          else openUrl(target.url);
        },
      }));
      callback(links.length ? links : undefined);
    },
  };
}
