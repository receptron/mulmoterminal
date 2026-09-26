// A Markdown document's leading YAML front matter, which is metadata rather than body. In
// `common/` because the wiki page view (browser) and the Files preview (server, #2264) both
// render Markdown and must agree on where the body starts.

// Leading YAML frontmatter delimited by `---` lines (page format in helps/wiki.md).
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
// A leading byte-order mark, stripped before frontmatter detection.
const BOM_RE = /^\uFEFF/;

/** Drop a leading BOM + the frontmatter block so neither renders as stray content. */
export function stripFrontmatter(content: string): string {
  return content.replace(BOM_RE, "").replace(FRONTMATTER_RE, "");
}
