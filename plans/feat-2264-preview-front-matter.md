# feat: the Markdown preview does not render front matter as body (#2264)

## Problem
A document opening with a YAML front matter block (Jekyll / Obsidian / Hugo style, which agents
write often) rendered it as content: marked read the opening `---` as a rule and the block plus
its closing `---` as a setext heading, so `docs/guide/en/basics.md` began with
`<hr><h2>title: … layout: default …</h2>`.

## Fix
`/api/files/browse/md` renders `splitFrontmatter(text).body` in both the plain and the embed
document. `splitFrontmatter` comes from `@mulmoclaude/markdown-utils` (now a direct dependency;
it was already installed through the markdown plugin, and `yarn.lock` does not change), imported
from its `markdown/frontmatter` subpath as the Canvas plugin does. It strips a block only when it
parses as YAML. The block is dropped, not shown; the issue asked only for that first.

## Why not the wiki's regex
The first version moved the wiki's `stripFrontmatter` into `common/` and used it here. Cross review
found that it strips ANY leading `---` … `---`, so a document that opens with a thematic break, or
has a malformed header, lost content up to the next `---`. The maintainer chose the canonical
parser, the one MulmoClaude and the Canvas use. The wiki keeps its own rule, unchanged.

## Spec
`test/server/files/files-browse.spec.ts`:
- both documents start at the body
- kept: a rule in the middle, a document opening with a rule, a header whose YAML does not parse
