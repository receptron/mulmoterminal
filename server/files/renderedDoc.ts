// The self-contained HTML documents the browse routes serve for files worth showing as
// something other than their source (#808). Every one of them opens in its own tab under
// `Content-Security-Policy: sandbox`, which is what shapes the rules here:
//
//   - no script, no external stylesheet, no webfont — a sandboxed document cannot run the
//     first and should not need a request for the others. That is a rule about what THIS shell
//     emits: a route that needs a script appends one nonce'd script of its own under a policy of
//     its own — the Files pane's scroll reporter (#2157) and the tab's toolbar (#3238,
//     renderedTabTools.ts) — and the shell stays a shell,
//   - colours follow the READER's system theme, since the page cannot ask the app which
//     theme is on — except in the Files pane, which says so on the URL (#2263, themeStyle),
//   - and every value taken from the file is escaped, because "the sandbox will catch it"
//     is not a reason to emit broken markup.
//
// Pure: text in, HTML string out. The routes own the reading, the caps and the headers.
import type { PreviewTheme } from "../../common/previewTheme.js";
import { isLightColor } from "../../common/themeVars.js";
import { parseDelimited } from "../../common/delimited.js";

/** HTML-escape a value that lands in text content or an attribute. */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

// Token colours for a coloured fence (#2579, codeHighlight.ts), one palette per background. Keyed by
// the class `classHighlighter` puts on a token; a class named in neither palette keeps the text colour.
type TokenPalette = Record<string, string>;
const LIGHT_TOKENS: TokenPalette = {
  keyword: "#cf222e",
  string: "#0a3069",
  string2: "#0a3069",
  comment: "#6e7781",
  number: "#0550ae",
  bool: "#0550ae",
  atom: "#0550ae",
  literal: "#0550ae",
  typeName: "#953800",
  className: "#953800",
  namespace: "#953800",
  macroName: "#953800",
  definition: "#8250df",
  propertyName: "#0550ae",
  meta: "#8250df",
  heading: "#0550ae",
  inserted: "#116329",
  deleted: "#82071e",
  invalid: "#cf222e",
};
const DARK_TOKENS: TokenPalette = {
  keyword: "#c678dd",
  string: "#98c379",
  string2: "#98c379",
  comment: "#7f848e",
  number: "#d19a66",
  bool: "#d19a66",
  atom: "#d19a66",
  literal: "#d19a66",
  typeName: "#e5c07b",
  className: "#e5c07b",
  namespace: "#e5c07b",
  macroName: "#e5c07b",
  definition: "#61afef",
  propertyName: "#61afef",
  meta: "#56b6c2",
  heading: "#e06c75",
  inserted: "#98c379",
  deleted: "#e06c75",
  invalid: "#e06c75",
};
const tokenStyle = (palette: TokenPalette): string =>
  Object.entries(palette)
    .map(([token, colour]) => `.tok-${token}{color:${colour}}`)
    .join("");

const STYLE = [
  ":root{color-scheme:light dark}",
  "body{max-width:48rem;margin:2rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.6;color:#1a1a2e;background:#fff}",
  "pre{background:#f4f4f4;padding:1rem;overflow:auto}code{font-family:ui-monospace,monospace}img{max-width:100%}",
  "a{color:#0b57d0}blockquote{margin:0;padding:0 1rem;border-left:4px solid #d0d0d8;color:#55555f}",
  "table{border-collapse:collapse}th,td{border:1px solid #d0d0d8;padding:.25rem .5rem}",
  ".tok-link,.tok-url{text-decoration:underline}.tok-strong{font-weight:bold}.tok-emphasis{font-style:italic}",
  tokenStyle(LIGHT_TOKENS),
  "@media(prefers-color-scheme:dark){",
  "body{color:#e6e6ea;background:#16161a}",
  "pre{background:#232329}",
  "a{color:#8ab4f8}blockquote{border-left-color:#3a3a44;color:#a0a0aa}",
  "th,td{border-color:#3a3a44}",
  tokenStyle(DARK_TOKENS),
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
    tokenStyle(isLightColor(theme.bg) ? LIGHT_TOKENS : DARK_TOKENS),
  ].join("");
}

/** Wrap rendered body HTML in the shared document shell. */
export function htmlDoc(bodyHtml: string, title: string, extraStyle = ""): string {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}${extraStyle}</style>`;
  return `<!doctype html><html><head>${head}</head><body>${bodyHtml}</body></html>`;
}

/** A rendering and the style it needs, for whichever shell shows it: the plain one the Files pane
 *  embeds, or the tab's with its toolbar (renderedTabTools.ts). */
export interface RenderedParts {
  html: string;
  style: string;
}

/** A JSON file, indented. Unparseable text is shown AS IT IS rather than replaced by an
 *  error: a file that fails to parse is exactly when someone needs to look at it. With a theme —
 *  the Files pane's Preview (#3137) — it takes the app's colours, as a table does. */
export function jsonHtmlParts(text: string, theme: PreviewTheme | null = null): RenderedParts {
  return { html: `<pre><code>${escapeHtml(prettyJson(text))}</code></pre>`, style: theme ? themeStyle(theme) : "" };
}

export function jsonHtmlDoc(text: string, title: string, theme: PreviewTheme | null = null): string {
  const { html, style } = jsonHtmlParts(text, theme);
  return htmlDoc(html, title, style);
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** The table's own surfaces in the app's theme, after TABLE_STYLE so it wins there as themeStyle
 *  does over STYLE: the sticky header must hide the rows under it, so it takes the page's ground. */
const tableThemeStyle = (theme: PreviewTheme): string => `thead th{background:${theme.bg}}tbody tr:nth-child(even){background:${theme.subtle}}`;

/** A delimited file as a table, first row as the header. An empty file renders as a note,
 *  not an empty table — "nothing here" reads better than a bare frame. With a theme — the Files
 *  pane's Preview (#2559) — it takes the app's colours instead of the reader's system ones. */
export function tableHtmlParts(text: string, title: string, delimiter: string, theme: PreviewTheme | null = null): RenderedParts {
  const style = theme ? `${TABLE_STYLE}${themeStyle(theme)}${tableThemeStyle(theme)}` : TABLE_STYLE;
  const rows = parseDelimited(text, delimiter);
  const [header, ...body] = rows;
  if (!header) return { html: `<p>${escapeHtml(title)} is empty.</p>`, style };
  const cells = (values: string[], tag: "th" | "td") => values.map((v) => `<${tag}>${escapeHtml(v)}</${tag}>`).join("");
  const bodyRows = body.map((r) => `<tr>${cells(r, "td")}</tr>`).join("");
  const table = `<table><thead><tr>${cells(header, "th")}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  return { html: `<div class="wrap">${table}</div>`, style };
}

export function tableHtmlDoc(text: string, title: string, delimiter: string, theme: PreviewTheme | null = null): string {
  const { html, style } = tableHtmlParts(text, title, delimiter, theme);
  return htmlDoc(html, title, style);
}
