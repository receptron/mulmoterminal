# Copy button on code blocks in rendered markdown (#2998)

## Goal

Every code block this app renders as markdown gets a copy button in its top-right corner, copying
the block's source as written (a ```markdown block keeps its `#` and `-`). Same button, wording and
safety as MulmoClaude (receptron/mulmoclaude#3125, #3151).

Surfaces: everything through `MarkdownProse` (conversation pane, skills, What's new, release notes,
blueprints) and `WikiProse` (wiki browser). `/files` Preview (#2615) and the canvas (the markdown
plugin) already have their own.

## Approach

- `src/appMarked.ts` — a `Marked` instance of the app's own with `rawHtmlPolicyExtension` +
  `codeCopyExtension` from `@mulmoclaude/markdown-utils`. Not the global `marked`: the markdown
  plugin's View calls `marked.use(...)` on the global when it mounts, which is why a reply rendered
  an inert, attribute-stripped button once a document had been opened on the canvas.
- `installMarkdownCodeCopy(document)` from `main.ts`: i18n labels + the one delegated click listener
  (nonce-checked; a forged button copies nothing).
- `markdownProse.ts`: the per-element permitted list gains the wrapper marker, the button's nonce /
  labels, and the icon's geometry. No `class` — styling is by attribute in `src/style.css`.
- `wikiMarkdown.ts`: the raw-HTML rule now strips `class` from the `[[link]]` spans core emits as raw
  HTML, so their class is put back on `span[data-page]`; the button's utility classes are removed so
  the style.css rules apply as they do in a reply.

## Out of scope

- A manual-select fallback when the Clipboard API is missing (plain `http://<lan-ip>`): the button
  does nothing there, as in MulmoClaude.
- Copying a whole reply as markdown.

## Tests

`test/src/markdownCodeCopy.spec.ts`, on both renderers: copies the source verbatim, one button per
block, forged button inert, author class/style dropped, unaffected by `marked.use` on the global,
wiki links still links.
