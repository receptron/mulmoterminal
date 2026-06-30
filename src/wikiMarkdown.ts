// Render a wiki page body to safe HTML for v-html. Pipeline:
//   1. strip YAML frontmatter (the page format leads with a `---` block).
//   2. marked → HTML. `[[wiki links]]` are plain text to marked, so they survive.
//   3. renderWikiLinks → turns the surviving `[[links]]` into
//      `<span class="wiki-link" data-page="…">` (shared core impl, so MT and
//      MulmoClaude resolve identically).
//   4. DOMPurify → sanitize (LLM-authored content over a shared workspace).
//   5. rewrite <img> srcs to MT's raw-file route (core ships no rewriter).
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
  const md = marked.parse(stripFrontmatter(content), { async: false }) as string;
  const linked = renderWikiLinks(md);
  // Keep the data-page hook on wiki-link spans (DOMPurify allows data-* by default).
  const clean = DOMPurify.sanitize(linked, { ADD_ATTR: ["target"] });
  // Rewrite image refs on the sanitized DOM, then re-serialize.
  const doc = new DOMParser().parseFromString(clean, "text/html");
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = img.getAttribute("src");
    if (src) img.setAttribute("src", rewriteWikiImageSrc(src));
  }
  return doc.body.innerHTML;
}
