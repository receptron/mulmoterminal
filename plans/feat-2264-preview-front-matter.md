# feat: the Markdown preview does not render front matter as body (#2264)

## Problem
A document opening with a YAML front matter block (Jekyll / Obsidian / Hugo style, which agents
write often) rendered it as content: marked read the opening `---` as a rule and the block plus
its closing `---` as a setext heading, so `docs/guide/en/basics.md` began with
`<hr><h2>title: … layout: default …</h2>`.

## Fix
- `stripFrontmatter` (leading BOM + a leading `---` … `---` block) moves verbatim from
  `src/wikiMarkdown.ts` to `common/frontmatter.ts`. The wiki page view and the Files preview now
  share one rule for where the body starts.
- `/api/files/browse/md` renders `stripFrontmatter(text)` in both the plain and the embed
  document. The block is dropped, not shown; the issue asked only for that first.

## Not matched with the Canvas plugin
The markdown plugin uses `parseFrontmatter` from `@mulmoclaude/markdown-utils`, which strips only
when the YAML parses. That package is not a direct dependency here, so this keeps the repo's
existing rule rather than adding one. A malformed block is therefore stripped here and kept there.

## Spec
- `test/common/frontmatter.spec.ts`: the existing wiki cases, plus a mid-document `---`, CRLF,
  and an unclosed block
- `test/server/files/files-browse.spec.ts`: both documents start at the body; a rule in the middle
  of the body stays
