// Detect file-path tokens in a line of terminal text so they can be linkified. Pure —
// no filesystem, no DOM. Returns half-open [start, end) UTF-16 string-index ranges.
//
// A token is a maximal run of path characters (everything except whitespace, quotes,
// ASCII + full-width brackets, `:`, and separating punctuation incl. `、。`) that:
//   - is not part of a URL (no leading `//`, not preceded by `:`; URLs are the
//     WebLinksAddon's job),
//   - contains at least one `/`, and
//   - ends in a file extension holding at least one letter — so `hero.gif` / `a.tar.gz`
//     match but a fraction like `1/2.5` does not.
// A trailing `.` (a sentence period clinging to the token) is trimmed off the end.

export interface FilePathLink {
  start: number; // inclusive UTF-16 index
  end: number; // exclusive UTF-16 index
  text: string;
}

const PATH_TOKEN = /[^\s"'`()[\]{}<>（）「」【】:,;、。]+/g;
// A trailing file extension: a dot then 1-10 alnum at end-of-string.
const TRAILING_EXTENSION = /\.([A-Za-z0-9]{1,10})$/;
const HAS_LETTER = /[A-Za-z]/;

// True when `text` ends in a file extension holding at least one letter — so `hero.gif`
// / `a.tar.gz` qualify but a fraction like `1/2.5` does not.
function endsInFileExtension(text: string): boolean {
  const ext = TRAILING_EXTENSION.exec(text);
  return ext !== null && HAS_LETTER.test(ext[1]);
}

export function findFilePathLinks(line: string): FilePathLink[] {
  const links: FilePathLink[] = [];
  for (const match of line.matchAll(PATH_TOKEN)) {
    const start = match.index;
    if (start === undefined) continue;
    let text = match[0];
    let end = start + text.length;
    while (text.endsWith(".")) {
      text = text.slice(0, -1);
      end -= 1;
    }
    if (text.startsWith("//")) continue; // protocol-relative URL, not a path
    if (start > 0 && line[start - 1] === ":") continue; // scheme (`http:`) or `file:line`
    if (!text.includes("/")) continue;
    if (!endsInFileExtension(text)) continue;
    links.push({ start, end, text });
  }
  return links;
}
