# The file surfaces, and why they are allowed different things

Four surfaces in this app put a file on screen, and they do **not** share a containment rule.
The differences are deliberate and were each argued separately, but until now they were argued in
four different files — so the only way to know that opening a `.md` in the right pane and opening
the same `.md` at `/files` are different acts was to read all four.

This page is that comparison in one place. Read it before moving a renderer between surfaces, or
before "unifying" two of them.

## The rule in one line

**How far a surface may reach is set by WHO chose the path, not by what it renders.**

A directory the user zoomed into is a narrower claim than a path a browser put in a query string,
which is narrower again than a path an agent the user launched asked for by name. The renderers
differ as a consequence of that, not as a design of their own.

## The four, widest containment last

| surface | root | what it may reach | who chose the path |
|---|---|---|---|
| **Right pane** (`TerminalGrid` → `FilesPane`, `canvas-target` set) | the expanded cell's directory | that directory's subtree | the user, by zooming a cell |
| **Full screen** (`/files?cwd=`, `FilesOverlay` → `FilesPane`) | whatever `?cwd=` says | that base's subtree | a browser, through a query string |
| **Watched documents** (`containForWatching`) | the workspace + every live session directory | those subtrees | a browser, checked against roots the server already serves |
| **`presentDocument` / `presentHtml` / …** (`backends/files/openPath.ts`) | **none** | any file of the right extension, anywhere | an agent the user launched |

### The right pane re-roots; it does not follow a prop

`FilesPane` **never watches its `cwd` prop** (`defineExpose`'s contract, FilesPane.vue): reacting
to it would discard a buffer the host may still be asking the user about. The host calls `reload`
when the root changes and it has already cleared that with the user. `TerminalGrid` re-roots the
pane to the cell being zoomed, which is why the right pane is bound to a directory the user
picked by looking at it.

### The full screen takes its base from the URL

`browseBase` reads `?cwd=` and uses it as the base, falling back to the server's default cwd. It
is **not** checked against the saved projects or any other list. The gate is `resolveContained`,
which stops `path` escaping that base — lexically and through a symlink — and nothing narrows
where the base itself may point.

So the full-screen view is not "the right pane, bigger". It is the surface where the *base* is an
input.

### `presentDocument` has no containment root, on purpose

`backends/files/openPath.ts` says so in its own header, and names the reason: a tool-call path came from
an agent the user launched, while a channel name is a string a browser chose. It also points at
its opposite — `backends/files/fileOps.ts` exists to **confine** a plugin to one directory. Two modules,
opposite purposes; do not reach for one when you mean the other.

The rules themselves live in `@mulmoclaude/core/files` (`byPath.ts`), shared with MulmoClaude so
one tool call cannot mean two different things in the two apps.

## Why the same `.md` renders differently, and why that is not a bug to "fix" in isolation

The right pane can open a document **on the canvas**, which mounts the markdown plugin's view: an
in-app Shadow DOM component that registers marked extensions and renders mermaid, maths and the
rest. The full-screen view has no canvas to open into, so a `.md` goes to the **preview**, which is
an iframe served from `/api/files/browse/md` and built by a **`marked` of the server's own, with
none of the plugin's extensions** — it drops a YAML front matter block, points relative images at
the raw route, numbers code blocks for the copy button, and the embedded document hands external
link clicks to the pane. Maths therefore renders as code there.

A mermaid fence is the one diagram the preview draws itself (#2991), and how it does so is set by
the sandbox. The preview is served under `sandbox allow-scripts; script-src 'nonce-…'` with no
`allow-same-origin`: that keeps a previewed file's own scripts inert and blocks any external
script that carries no nonce. It does **not** block a `<script type="module">` that carries the
nonce, nor the imports that script makes — a static or dynamic import inherits the importing
script's nonce (measured in Chromium and WebKit; `plans/feat-files-preview-mermaid.md` describes
the probe). What DOES stop an import from this document is CORS: the origin is opaque, so a module
fetch goes out with `Origin: null` and needs `Access-Control-Allow-Origin` on the answer. So the
server serves mermaid's own ESM build under `/api/files/mermaid/<version>/…` with that header
(`server/files/mermaidAssets.ts`), and the embedded document ends with a nonce'd module script
that imports it and draws each fence, folding the numbered code block under the diagram
(`server/files/previewMermaid.ts`). The plain `…/md` document a new tab opens is served under a
bare `sandbox` and runs nothing, so there the fence stays a code block.

**So "make both surfaces render the same" is a containment decision before it is a rendering
one.** Moving the plugin's renderer to the full-screen view would render a file chosen through a
query string with the machinery built for a file an agent named. The preview's own diagram path
keeps the isolation at the cost of a second rendering path that drifts when the plugin gains a
feature — a trade taken knowingly for mermaid, and the reason maths is still code there. Both are
defensible; neither is a refactor.

## An HTML page, an image, a PDF or media in the pane serves bytes, so it takes the raw route's base

The pane READS text through the browse routes, whose base is whatever `?cwd=` says. Showing an
image, a PDF, a video or an audio file, or rendering an HTML page (#2269, #2674), is different: it serves the file's bytes to the browser,
which the raw route deliberately allows only under the workspace or a live session's directory
(`authorizedServingBase`). So a picture, a PDF, a video or a sound is fetched from `/api/files/raw` (a PDF there is
the one type served without the CSP sandbox, since WebKit draws nothing in an opaque frame, and the
pane's frame adds no `sandbox` attribute for the same reason), and an HTML page from
`/api/files/page/<cwd>/<path>` (`server/backends/files/filesPage.ts`), which authorises its base the same
way and hands anything but the page itself back to the raw route. Neither reaches a file the raw
route would refuse. The page goes out under presentHtml's CSP — an opaque origin and no fetch/XHR,
though images (any https origin, and `'self'`) and the curated CDN list still load — and it is
addressed by path only so that an image it links relatively resolves beside it. A relative
stylesheet or script does not load: the CSP has no `'self'` for them.

Because that page runs its own scripts, the Markdown preview's message wire (`useMdPreviewScroll`)
listens only to a frame a Markdown document was loaded into, and that document gets a frame of its
own (the iframe is keyed by kind): `contentWindow` stays the same object across a navigation, so a
page being replaced by a document could otherwise still speak on the wire in between. A page is
loaded only while its Preview is up.

The frame alone is not trusted either. A Markdown file is not sanitised, and one can navigate its own
frame (a `<meta http-equiv="refresh">`, say) to a page that then speaks from that same window — with
no click, since the Markdown document loads ahead of its Preview. So the pane mints a token for each
document it asks for (`wire=` in its URL), the server writes it into the nonce'd reporter, which
stamps it on every message, and the pane hears only messages carrying the token of the document it
asked for (#2515). A page the frame was navigated to never had it.

A consequence: in the full-screen view on a base that is not a session directory, the text still
opens and the picture, PDF, player or page does not — the same answer the raw route has always given there.

A CSV / TSV table Preview (#2559) is on the other side of this line. Like Markdown it is a document
the server renders from the file's text — `/api/files/browse/table`, escaped cells under a bare
`sandbox` CSP, no script — so it takes the browse routes' base and previews wherever the text opens,
the full-screen view included.

## What to check before changing any of this

- **Which surface are you in?** `canvas-target` distinguishes the two `FilesPane` mounts and is the
  only reason one of them can reach the canvas.
- **Did the base move, or the path?** `resolveContained` guards the path. Nothing guards the base
  except the choice of surface.
- **Are you widening who may choose?** A renderer is not the unit of risk here; the path's origin
  is.
