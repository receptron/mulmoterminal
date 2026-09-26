// The self-contained HTML documents the browse routes serve for files worth showing as
// something other than their source (#808). Every one of them opens in its own tab under
// `Content-Security-Policy: sandbox`, which is what shapes the rules here:
//
//   - no script, no external stylesheet, no webfont — a sandboxed document cannot run the
//     first and should not need a request for the others. That is a rule about what THIS shell
//     emits, and it has not changed: the Markdown route appends one nonce'd script of its own
//     for the Files pane to hear scrolling through, under a policy of its own (#2157),
//   - colours follow the READER's system theme, since the page cannot ask the app which
//     theme is on — except in the Files pane, which says so on the URL (#2263, themeStyle),
//   - and every value taken from the file is escaped, because "the sandbox will catch it"
//     is not a reason to emit broken markup.
//
// Pure: text in, HTML string out. The routes own the reading, the caps and the headers.
import type { PreviewTheme } from "../../common/previewTheme.js";
import { isLightColor } from "../../common/themeVars.js";

/** HTML-escape a value that lands in text content or an attribute. */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const STYLE = [
  ":root{color-scheme:light dark}",
  "body{max-width:48rem;margin:2rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.6;color:#1a1a2e;background:#fff}",
  "pre{background:#f4f4f4;padding:1rem;overflow:auto}code{font-family:ui-monospace,monospace}img{max-width:100%}",
  "a{color:#0b57d0}blockquote{margin:0;padding:0 1rem;border-left:4px solid #d0d0d8;color:#55555f}",
  "table{border-collapse:collapse}th,td{border:1px solid #d0d0d8;padding:.25rem .5rem}",
  "@media(prefers-color-scheme:dark){",
  "body{color:#e6e6ea;background:#16161a}",
  "pre{background:#232329}",
  "a{color:#8ab4f8}blockquote{border-left-color:#3a3a44;color:#a0a0aa}",
  "th,td{border-color:#3a3a44}",
  "}",
].join("");

// A wide table has to scroll inside its own box rather than push the page sideways, and the
// header row has to stay put while the body scrolls — both only matter for the table view,
// so they ride with it instead of widening the shared sheet.
const TABLE_STYLE = [
  "body{max-width:none}",
  ".wrap{overflow:auto;max-height:85vh}",
  "table{font-size:13px;font-family:ui-monospace,monospace}",
  "thead th{position:sticky;top:0;background:#fff;text-align:left}",
  "tbody tr:nth-child(even){background:#f7f7fa}",
  "@media(prefers-color-scheme:dark){thead th{background:#16161a}tbody tr:nth-child(even){background:#1d1d23}}",
].join("");

/** The app's theme, as the document's own rules. Appended after STYLE, so it wins over the
 *  system-theme rules there; `color-scheme` follows the background so form controls and
 *  scrollbars match it. Every value was checked to be a hex colour (previewThemeFromQuery). */
export function themeStyle(theme: PreviewTheme): string {
  return [
    `:root{color-scheme:${isLightColor(theme.bg) ? "light" : "dark"}}`,
    `body{color:${theme.fg};background:${theme.bg}}`,
    `pre{background:${theme.subtle}}`,
    `a{color:${theme.link}}blockquote{border-left-color:${theme.border};color:${theme.muted}}`,
    `th,td{border-color:${theme.border}}`,
  ].join("");
}

/** Wrap rendered body HTML in the shared document shell. */
export function htmlDoc(bodyHtml: string, title: string, extraStyle = ""): string {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}${extraStyle}</style>`;
  return `<!doctype html><html><head>${head}</head><body>${bodyHtml}</body></html>`;
}

/** A JSON file, indented. Unparseable text is shown AS IT IS rather than replaced by an
 *  error: a file that fails to parse is exactly when someone needs to look at it. */
export function jsonHtmlDoc(text: string, title: string): string {
  return htmlDoc(`<pre><code>${escapeHtml(prettyJson(text))}</code></pre>`, title);
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** The delimiter a separated-values file uses, from its extension. */
export const delimiterForExtension = (ext: string): string => (ext.toLowerCase() === ".tsv" ? "\t" : ",");

/**
 * Rows of a delimited file, by RFC 4180: a field may be quoted, a quoted field may contain
 * the delimiter, a newline, or a doubled `""` standing for one quote.
 *
 * Hand-written rather than pulled in: the rule is small enough to state exactly, and the
 * failure mode of a loose one is a table that silently splits a field in half — which is
 * worse than not rendering at all, and invisible without the cases below.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    // Only at the START of a field — `5" pipe` is text, not an opening quote.
    if (ch === '"' && field === "") {
      const quoted = readQuotedField(text, i + 1);
      field = quoted.value;
      i = quoted.next;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i++;
      continue;
    }
    const rowBreak = rowBreakLength(text, i);
    if (rowBreak > 0) {
      endRow();
      i += rowBreak;
      continue;
    }
    field += ch;
    i++;
  }
  // A trailing newline ends the last row rather than starting an empty one.
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

// How many characters the row break at `i` occupies: CRLF is one break, not two.
const rowBreakLength = (text: string, i: number): number => {
  if (text[i] === "\r") return text[i + 1] === "\n" ? 2 : 1;
  return text[i] === "\n" ? 1 : 0;
};

// A quoted field, scanned from just after its opening quote. `""` is one literal quote; an
// unterminated quote takes the rest of the file rather than dropping it.
function readQuotedField(text: string, start: number): { value: string; next: number } {
  let value = "";
  let i = start;
  while (i < text.length) {
    if (text[i] === '"') {
      if (text[i + 1] !== '"') return { value, next: i + 1 };
      value += '"';
      i += 2;
      continue;
    }
    value += text[i];
    i++;
  }
  return { value, next: i };
}

/** A delimited file as a table, first row as the header. An empty file renders as a note,
 *  not an empty table — "nothing here" reads better than a bare frame. */
export function tableHtmlDoc(text: string, title: string, delimiter: string): string {
  const rows = parseDelimited(text, delimiter);
  if (rows.length === 0) return htmlDoc(`<p>${escapeHtml(title)} is empty.</p>`, title, TABLE_STYLE);
  const [header, ...body] = rows;
  if (!header) return htmlDoc(`<p>${escapeHtml(title)} is empty.</p>`, title, TABLE_STYLE);
  const cells = (values: string[], tag: "th" | "td") => values.map((v) => `<${tag}>${escapeHtml(v)}</${tag}>`).join("");
  const bodyRows = body.map((r) => `<tr>${cells(r, "td")}</tr>`).join("");
  const table = `<table><thead><tr>${cells(header, "th")}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  return htmlDoc(`<div class="wrap">${table}</div>`, title, TABLE_STYLE);
}
