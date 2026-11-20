// The lines of `MEMORY.md` that point at one memory, taken out when the memory is deleted and put
// back when that is undone (#3331). Pure: the index's text in, its new text out.
import { indexEntries } from "./memory-health.js";

/** A line taken out of the index: where it stood, and the line itself with its own ending. */
export interface RemovedIndexLine {
  at: number;
  line: string;
}

/** The index's lines, each with the ending it has, so joining them gives back the same text. */
export const indexLines = (text: string): string[] => text.split(/(?<=\n|\r(?!\n))/).filter((line) => line !== "");

/** The index without the lines that link to `file`, and those lines. */
export function withoutEntry(indexText: string, file: string): { text: string; removed: RemovedIndexLine[] } {
  const lines = indexLines(indexText);
  const removed = lines.map((line, at) => ({ at, line })).filter(({ line }) => indexEntries(line).includes(file));
  return { text: lines.filter((_line, at) => !removed.some((gone) => gone.at === at)).join(""), removed };
}

/** The index with removed lines added back at its end — for when it changed after they were taken
 *  out, so where they stood no longer means anything. A line is left out only when the index already
 *  lists everything it links to: one that also linked another memory still carries that one's entry. */
export function withEntryBack(indexText: string, removed: readonly RemovedIndexLine[]): string {
  const listed = new Set(indexEntries(indexText));
  const missing = removed.filter(({ line }) => indexEntries(line).some((entry) => !listed.has(entry)));
  if (missing.length === 0) return indexText;
  const ending = /\r\n|\r|\n/.exec(indexText)?.[0] ?? "\n";
  const parts = [indexText];
  if (indexText !== "" && !/[\r\n]$/.test(indexText)) parts.push(ending);
  missing.forEach(({ line }) => parts.push(/[\r\n]$/.test(line) ? line : `${line}${ending}`));
  return parts.join("");
}
