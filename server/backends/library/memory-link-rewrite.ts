// The `[[links]]` a merge of memory points elsewhere (#3331), decided on texts alone — nothing here reads a disk.
import { Lexer } from "marked";
import { parseMemoryFrontmatter } from "../../../common/libraryMemory.js";
import { isToken, MEMORY_LINK, type MarkdownToken } from "./memory-health.js";

interface TextRange {
  start: number;
  end: number;
}

/** The code tokens under one token, in the order they appear. */
function codeTokensOf(token: MarkdownToken): MarkdownToken[] {
  if (token.type === "code" || token.type === "codespan") return [token];
  return [...(token.tokens ?? []), ...(token.items ?? [])].filter(isToken).flatMap(codeTokensOf);
}

const escapeForPattern = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where `piece` is in `text` from `from` on: as it is, or with an indent before each of its later lines —
 *  how a block inside a list item is written, which the lexer hands back with the indent taken off. */
function findIndented(text: string, piece: string, from: number): TextRange | null {
  const exact = text.indexOf(piece, from);
  if (exact !== -1) return { start: exact, end: exact + piece.length };
  const pattern = new RegExp(piece.split("\n").map(escapeForPattern).join("\n[ \\t]*"), "g");
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  return match === null ? null : { start: match.index, end: match.index + match[0].length };
}

/** Where code is in `text`, as offsets into it — the spans and blocks the renderer and the health check
 *  leave inert. Each top-level token is found in the text in turn, and its code in order inside it.
 *  The lexer does not hand the text back exactly (it rewrites `\r`, trims a last line, takes the indent
 *  off a list item's lines), so a token is also found by its trimmed form or with indents; one holding
 *  code that still cannot be found makes the whole answer null, so code is never taken for prose. */
export function codeRanges(text: string): TextRange[] | null {
  const ranges: TextRange[] = [];
  const cursor = { at: 0 };
  const placed = new Lexer()
    .lex(text)
    .filter(isToken)
    .every((token) => {
      const codes = codeTokensOf(token);
      const found = findIndented(text, token.raw, cursor.at) ?? findIndented(text, token.raw.trimEnd(), cursor.at);
      if (found === null) return codes.length === 0;
      cursor.at = found.end;
      const segment = text.slice(found.start, found.end);
      const inner = { at: 0 };
      return codes.every((code) => {
        const at = findIndented(segment, code.raw, inner.at) ?? findIndented(segment, code.raw.trimEnd(), inner.at);
        if (at === null) return false;
        inner.at = at.end;
        ranges.push({ start: found.start + at.start, end: found.start + at.end });
        return true;
      });
    });
  return placed ? ranges : null;
}

/** A line end other than `\r\n`: a lone `\r`, or a `\n` with no `\r` before it. */
const MIXED_LINE_ENDS = /\r(?!\n)|(?<!\r)\n/;

/** A memory's text with every `[[name]]` in its body, outside code, that names one of `from` pointed at
 *  `to` instead, and how many were. The frontmatter is left byte for byte: a link is the body's, as the
 *  health check and the reader take it. Null when where the code is cannot be told, so nothing is
 *  rewritten blind. */
export function rewriteLinks(text: string, from: ReadonlySet<string>, to: string): { text: string; count: number } | null {
  // The lexer reads `\r\n` as `\n`, so code in a CRLF text is found in its `\n` form and the line ends
  // put back after; a text that mixes line ends could not be put back exactly, and is looked at as it is.
  if (text.includes("\r\n") && !MIXED_LINE_ENDS.test(text)) {
    const rewritten = rewriteLinks(text.replace(/\r\n/g, "\n"), from, to);
    return rewritten === null ? null : { ...rewritten, text: rewritten.text.replace(/\n/g, "\r\n") };
  }
  const { body } = parseMemoryFrontmatter(text);
  // The parser reads a normalised copy; a body that is not the text's own end cannot be put back exactly.
  if (!text.endsWith(body)) return null;
  const rewritten = rewriteBodyLinks(body, from, to);
  return rewritten === null ? null : { ...rewritten, text: `${text.slice(0, text.length - body.length)}${rewritten.text}` };
}

function rewriteBodyLinks(body: string, from: ReadonlySet<string>, to: string): { text: string; count: number } | null {
  const ranges = codeRanges(body);
  if (ranges === null) return null;
  const inCode = (offset: number): boolean => ranges.some((range) => offset >= range.start && offset < range.end);
  const rewritten = { count: 0 };
  const result = body.replace(MEMORY_LINK, (whole: string, name: string, offset: number) => {
    if (inCode(offset) || !from.has(name.trim())) return whole;
    rewritten.count += 1;
    return `[[${to}]]`;
  });
  return { text: result, count: rewritten.count };
}

/** The names a `[[link]]` reaches a memory by: its file name without `.md`, and its frontmatter name. */
export function namesOf(file: string, text: string): Set<string> {
  const name = parseMemoryFrontmatter(text).fields.name?.trim() ?? "";
  return new Set([file.replace(/\.md$/, ""), name].filter((candidate) => candidate !== ""));
}

/** The name a link to a memory is written with: its frontmatter name when a `[[link]]` can hold it,
 *  else its file name. */
export function linkNameOf(file: string, text: string): string {
  const name = parseMemoryFrontmatter(text).fields.name?.trim() ?? "";
  return /^[^\]\n]{1,200}$/.test(name) ? name : file.replace(/\.md$/, "");
}
