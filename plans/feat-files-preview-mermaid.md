# feat: mermaid diagrams in the Files pane's Markdown Preview

Issue: #2991

## Problem

A `mermaid` fence in the Preview (and the side-by-side view) is drawn as a code block. The
Preview is an iframe under `sandbox allow-scripts; script-src 'nonce-…'`, with no origin, and the
only script it runs is the server's nonce'd reporter. The right pane's Canvas renders diagrams
through the markdown plugin, but the full-screen `/files` view has no Canvas.

## What was measured first

A throwaway server with the Preview's exact CSP string, driven by headless Chromium and WebKit:

- a nonce'd `<script src>` and a nonce'd `<script type="module">` both load and run;
- a `import()` from a nonce'd script is NOT blocked by the policy — the import inherits the
  nonce. What refused it was CORS: the document is opaque-origin, so a module fetch carries
  `Origin: null` and needs `Access-Control-Allow-Origin` on the response;
- the file's own inline scripts and a nonce-less external script stay blocked.

So the sandbox does not have to change. The repo's docs said the CSP blocks dynamic import; that
is corrected here.

## Change

- `server/files/mermaidAssets.ts` — serves mermaid's ESM entry and its chunks from the installed
  package under `/api/files/mermaid/<version>/…`, with the CORS header an opaque-origin module
  fetch needs, immutable caching (the version is in the URL), and an allowlist: nothing else
  under `dist/` is reachable.
- `server/files/previewMermaid.ts` — pure. A `mermaid` fence is drawn as the numbered code block
  it always was (so the copy button and the pane's block count are untouched) inside a
  `<details>` that is open, with a hidden placeholder holding the source. A nonce'd module
  script, appended only when a document drew at least one, imports mermaid, renders each
  placeholder, replaces it with the SVG and collapses the details under it. A render failure
  leaves the code block open and writes the error above it. Theme follows the pane's (`dark` on a
  dark background), else the reader's. The script draws nothing until the document has a width:
  the pane loads the Markdown frame while the editor is up (`display:none`), and a document with
  no layout measures text as 0x0, on which mermaid draws an empty diagram or throws "svg element
  not in render tree" — reproduced by opening a file, waiting, then pressing Preview.
- `files-browse.ts` — the plain new-tab document is unchanged: it runs no script, so it gets no
  placeholder either.
- The reporter names the `<details>` summary from the host's label message, as it names the copy
  buttons; `previewCodeCopy.diagramSource` in every locale.

## Not done

- The Canvas keeps its own renderer (the markdown plugin's). This is a second rendering path, on
  purpose: the Preview is the surface where the base is a query-string input, and the plugin's
  view is not brought there.
- The plain `…/md` document opened in a new tab still shows the fence as code.
