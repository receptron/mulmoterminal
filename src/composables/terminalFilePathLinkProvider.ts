// Turns file paths in xterm terminal output into clickable links that open the file in a
// new browser tab (via the raw-file route, scoped to the session's cwd). Registered next
// to WebLinksAddon, which handles http/https URLs.
//
// The pure core (computeFilePathLinks) maps a row of terminal cells to link ranges in
// 1-based inclusive columns — accounting for wide (CJK) glyphs that occupy two columns —
// so the string ranges from findFilePathLinks land on the right cells.
import type { Terminal, ILinkProvider, ILink } from "@xterm/xterm";
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
    if (cell.width === 0) continue; // trailing half of the preceding wide glyph
    const chars = cell.chars.length ? cell.chars : " "; // an unwritten cell renders as a space
    for (let k = 0; k < chars.length; k++) {
      units.push(chars[k]);
      colStart.push(col);
      colEnd.push(col + cell.width - 1);
    }
  }
  return findFilePathLinks(units.join("")).map((hit) => ({
    text: hit.text,
    startX: colStart[hit.start] + 1,
    endX: colEnd[hit.end - 1] + 1,
  }));
}

export function rawFileUrl(filePath: string, cwd: string): string {
  return `/api/files/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(filePath)}`;
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

export function createFilePathLinkProvider(term: Terminal, getCwd: () => string | null, openUrl: (url: string) => void): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
      const cwd = getCwd();
      const cells = cwd ? readCells(term, bufferLineNumber) : null;
      if (!cwd || !cells) return callback(undefined);
      const links: ILink[] = computeFilePathLinks(cells).map((link) => ({
        text: link.text,
        range: { start: { x: link.startX, y: bufferLineNumber }, end: { x: link.endX, y: bufferLineNumber } },
        decorations: { pointerCursor: true, underline: true },
        activate: () => openUrl(rawFileUrl(link.text, cwd)),
      }));
      callback(links.length ? links : undefined);
    },
  };
}
