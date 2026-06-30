// Render a wiki page body to safe HTML for v-html. Pipeline (order matches
// MulmoClaude's helpers.ts so both hosts render identically):
//   1. strip YAML frontmatter (the page format leads with a `---` block).
//   2. renderWikiLinks → turn `[[links]]` into
//      `<span class="wiki-link" data-page="…">` BEFORE marked (it HTML-escapes the
//      surrounding text itself). Running before marked means a `[[x]]` inside a fenced
//      code block / code span ends up as inert escaped text after marked, NOT a live
//      link — running it on marked's HTML output would instead inject a clickable link
//      inside `<code>` and corrupt the snippet.
//   3. marked → HTML.
//   4. DOMPurify → sanitize (LLM-authored content over a shared workspace).
//   5. rewrite <img> srcs to MT's raw-file route (core ships no rewriter); make
//      `.wiki-link` spans keyboard-focusable (activated in WikiPageView).
import { marked } from "marked";
import DOMPurify from "dompurify";
import { renderWikiLinks } from "@mulmoclaude/core/wiki";
import { rewriteWikiImageSrc } from "./wikiImageSrc";

// Leading YAML frontmatter delimited by `---` lines (page format in helps/wiki.md).
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
// A leading byte-order mark, stripped before frontmatter detection.
const BOM_RE = /^\uFEFF/;

/** Drop a leading BOM + the frontmatter block so neither renders as stray content. */
export function stripFrontmatter(content: string): string {
  return content.replace(BOM_RE, "").replace(FRONTMATTER_RE, "");
}

/** Render a page body to sanitized HTML with `[[links]]` and rewritten image refs. */
export function renderWikiHtml(content: string): string {
  // renderWikiLinks first (it escapes the text), then marked — see the file header.
  const linked = renderWikiLinks(stripFrontmatter(content));
  const html = marked.parse(linked, { async: false }) as string;
  // DOMPurify keeps class + data-* by default (so the data-page hook survives).
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  // Rewrite image refs to MT's raw-file route.
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = img.getAttribute("src");
    if (src) img.setAttribute("src", rewriteWikiImageSrc(src));
  }
  // Make [[wiki links]] reachable + activatable without a mouse (the delegated
  // click/keydown handler in WikiPageView reads data-page).
  for (const link of Array.from(doc.querySelectorAll(".wiki-link"))) {
    link.setAttribute("role", "link");
    link.setAttribute("tabindex", "0");
  }
  return doc.body.innerHTML;
}
