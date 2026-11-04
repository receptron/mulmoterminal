// Detect file-path tokens in a line of terminal text so they can be linkified. Pure —
// no filesystem, no DOM. Returns half-open [start, end) UTF-16 string-index ranges.
//
// A token is a maximal run of path characters (everything except whitespace, quotes,
// ASCII + full-width brackets, `:`, and separating punctuation incl. `、。：；，！？`) that:
//   - is not part of a URL (no leading `//`, not preceded by `:`; URLs are the
//     WebLinksAddon's job),
//   - contains at least one `/`, and
//   - ends in a file extension holding at least one letter — so `hero.gif` / `a.tar.gz`
//     match but a fraction like `1/2.5` does not.
// A trailing `.` (a sentence period clinging to the token) is trimmed off the end.
// A location right after the path (`:42`, `:42:7`, `(12,5)`) joins the link's range and is
// reported beside it, so the click can open the file at that line.
//
// A path holding a space is linked whole only when something encloses it — quotes, backticks or
// brackets (`Read(/Users/me/My Docs/a.md)`) — and the enclosed text reads as one path: anchored
// (`/`, `~/`, `./`, `../`, a drive), ending in an extension, with the space inside a folder name.
//
// With `windowsPaths`, `\` separates too and a one-letter drive (`C:\x\a.md`, `D:/w/b.ts`) stays on
// the token. It is opt-in because on macOS and Linux `\` is an ordinary character in a file name.

import { locationAfterPath, type FileLocation } from "./filePathLocation";

export interface FilePathLink {
  start: number; // inclusive UTF-16 index
  end: number; // exclusive UTF-16 index — past the location when there is one
  text: string; // the path alone; with `windowsPaths`, `/`-separated even where the line printed `\`
  location?: FileLocation;
}

export interface FilePathLinkOptions {
  windowsPaths?: boolean;
}

const PATH_CHARS = "[^\\s\"'`()[\\]{}<>（）「」【】:,;、。：；，！？]+";
const PATH_TOKEN = new RegExp(PATH_CHARS, "g");
// A run never starts mid-word, so the drive is a lone letter: `ab:/x.ts` and `a.ts:12` still split at `:`.
const WINDOWS_PATH_TOKEN = new RegExp(`(?:[A-Za-z]:(?=[\\\\/]))?${PATH_CHARS}`, "g");
// A trailing file extension: a dot then 1-10 alnum at end-of-string.
const TRAILING_EXTENSION = /\.([A-Za-z0-9]{1,10})$/;
const HAS_LETTER = /[A-Za-z]/;
const SLASH_ONLY = /\//;
const SLASH_OR_BACKSLASH = /[\\/]/;

// True when `text` ends in a file extension holding at least one letter — so `hero.gif`
// / `a.tar.gz` qualify but a fraction like `1/2.5` does not.
function endsInFileExtension(text: string): boolean {
  const ext = TRAILING_EXTENSION.exec(text);
  return ext?.[1] !== undefined && HAS_LETTER.test(ext[1]);
}

// A sentence period clinging to the token is not part of the path.
function withoutTrailingPeriods(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === ".") end -= 1;
  return text.slice(0, end);
}

// A leading `\\` on Windows is a UNC share, which nothing that opens a clicked path can address.
function isUrlLike(text: string, before: string | undefined, windowsPaths: boolean): boolean {
  return text.startsWith("//") || (windowsPaths && text.startsWith("\\\\")) || before === ":";
}

const ENCLOSURE_CLOSERS: Record<string, string> = { '"': '"', "'": "'", "`": "`", "(": ")", "（": "）", "「": "」" };
const POSIX_ANCHOR = /^(?:\/(?!\/)|~\/|\.\.?\/)/;
const WINDOWS_ANCHOR = /^(?:\/(?!\/)|~[\\/]|\.\.?[\\/]|[A-Za-z]:[\\/])/;

const toSlashes = (text: string): string => text.replace(/\\/g, "/");

// Where the path ends inside `content` when the rest is a location (`…/a.ts:12`), or the whole of it.
function splitLocation(content: string): { pathLength: number; location?: FileLocation } {
  const lastDot = content.lastIndexOf(".");
  for (let k = lastDot + 1; lastDot !== -1 && k < content.length; k += 1) {
    const located = locationAfterPath(content.slice(k));
    if (located?.length === content.length - k) return { pathLength: k, location: located.location };
  }
  return { pathLength: content.length };
}

// A later word that is a flag or a path of its own makes the text a command line
// (`/bin/bash -lc cat /tmp/a.md`), not one path.
const STARTS_ARGUMENT = /^(?:-|\/|~[\\/]|\.\.?[\\/])/;

// Whether `words` (the path split at its spaces) read as one path: no word before the last ends in an
// extension (`./a.md and ./b.md`), none after the first starts an argument, and the last holds a
// separator — a space in the FILE name (`/usr/bin/grep foo.md`) cannot be told from a command.
function readsAsOnePath(words: string[], separator: RegExp): boolean {
  const last = words[words.length - 1] ?? "";
  if (!separator.test(last) || words.slice(0, -1).some(endsInFileExtension)) return false;
  return !words.slice(1).some((word) => STARTS_ARGUMENT.test(word));
}

// The enclosed text as one path, or null when it reads as words (`see src/a.ts for details`), as
// several paths, or as a command.
function enclosedPath(content: string, windowsPaths: boolean): { path: string; location?: FileLocation } | null {
  if (!content.includes(" ")) return null;
  if (!(windowsPaths ? WINDOWS_ANCHOR : POSIX_ANCHOR).test(content)) return null;
  const { pathLength, location } = splitLocation(content);
  const path = content.slice(0, pathLength);
  if (!endsInFileExtension(path) || !readsAsOnePath(path.split(" "), windowsPaths ? SLASH_OR_BACKSLASH : SLASH_ONLY)) return null;
  const opened = windowsPaths ? toSlashes(path) : path;
  return location ? { path: opened, location } : { path: opened };
}

const OPENER = /["'`(（「]/g;

function enclosedLinkAt(line: string, open: number, windowsPaths: boolean): FilePathLink[] {
  const opener = line[open] ?? "";
  const closer = ENCLOSURE_CLOSERS[opener];
  const close = closer === undefined ? -1 : line.indexOf(closer, open + 1);
  const content = close === -1 ? "" : line.slice(open + 1, close);
  const found = content.includes(opener) ? null : enclosedPath(content, windowsPaths);
  if (!found) return [];
  // A tool line can print the location after the enclosure: `Read(/x/My Docs/a.ts):12`.
  const after = found.location ? null : locationAfterPath(line.slice(close + 1));
  const location = found.location ?? after?.location;
  const end = after ? close + 1 + after.length : close;
  return [{ start: open + 1, end, text: found.path, ...(location ? { location } : {}) }];
}

function findEnclosedFilePaths(line: string, windowsPaths: boolean): FilePathLink[] {
  return [...line.matchAll(OPENER)].flatMap((match) => enclosedLinkAt(line, match.index, windowsPaths));
}

const insideAny = (start: number, spans: FilePathLink[]): boolean => spans.some((span) => start >= span.start && start < span.end);

export function findFilePathLinks(line: string, options: FilePathLinkOptions = {}): FilePathLink[] {
  const windowsPaths = options.windowsPaths === true;
  const enclosed = line.includes(" ") ? findEnclosedFilePaths(line, windowsPaths) : [];
  const tokens = findPathTokens(line, windowsPaths).filter((link) => !insideAny(link.start, enclosed));
  return [...enclosed, ...tokens].sort((a, b) => a.start - b.start);
}

function findPathTokens(line: string, windowsPaths: boolean): FilePathLink[] {
  const separator = windowsPaths ? SLASH_OR_BACKSLASH : SLASH_ONLY;
  const token = windowsPaths ? WINDOWS_PATH_TOKEN : PATH_TOKEN;
  const links: FilePathLink[] = [];
  for (const match of line.matchAll(token)) {
    // No `undefined` guard: matchAll requires a global regex and the spec sets `index` on every
    // match it yields, which is why the type is `number` rather than `number | undefined`.
    const start = match.index;
    const text = withoutTrailingPeriods(match[0]);
    const end = start + text.length;
    if (isUrlLike(text, line[start - 1], windowsPaths) || !separator.test(text) || !endsInFileExtension(text)) continue;
    const path = windowsPaths ? toSlashes(text) : text;
    const located = locationAfterPath(line.slice(end));
    links.push(located ? { start, end: end + located.length, text: path, location: located.location } : { start, end, text: path });
  }
  return links;
}
