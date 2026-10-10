// A `mermaid` fence in the Markdown Preview (#2991). The server draws it as the numbered code block
// it always was — the copy button and the pane's block count (common/previewCodeBlocks.ts) depend on
// that — inside an open disclosure, with a hidden placeholder holding the source beside it. The
// document's own module script, admitted by the same nonce as the reporter, then imports mermaid
// from this server, draws each placeholder and collapses the disclosure under the diagram. A fence
// that fails to render keeps its code block open with the error above it.
//
// Pure: text in, HTML in; the route owns the nonce and the asset URL. Nothing from the file is
// written into the script (mdPreviewEmbed.ts says why).
import type { Tokens } from "marked";
import { escapeHtml } from "./renderedDoc.js";
import { infoWord } from "../../common/previewCodeBlocks.js";
import { isLightColor } from "../../common/themeVars.js";
import type { PreviewTheme } from "../../common/previewTheme.js";

export const MERMAID_LANG = "mermaid";

/** mermaid's own theme names: the pane's background decides, or the reader's scheme when the pane
 *  sent no theme. */
export type MermaidTheme = "default" | "dark";

export const mermaidThemeFor = (theme: PreviewTheme | null): MermaidTheme | null => {
  if (!theme) return null;
  return isLightColor(theme.bg) ? "default" : "dark";
};

/** What the disclosure says until the host names it in the app's language. */
export const DIAGRAM_SOURCE_DEFAULT_LABEL = "Diagram source";

type CodeRenderer = (token: Tokens.Code) => string;

export interface DiagramFenceRenderer {
  code: CodeRenderer;
  /** How many mermaid fences this document drew — the script is appended only for one that drew any. */
  drawn: () => number;
}

/** The placeholder and the block it stands beside. The block is whatever `inner` drew, untouched. */
export const diagramFence = (source: string, block: string): string =>
  `<div class="mermaid-fence"><pre class="mermaid" data-mermaid-pending="1">${escapeHtml(source)}</pre>` +
  `<details class="mermaid-source" open><summary>${DIAGRAM_SOURCE_DEFAULT_LABEL}</summary>${block}</details></div>\n`;

/** Wrap a code renderer: a mermaid fence gets the placeholder beside the block `inner` draws for it,
 *  every other fence is `inner`'s alone. */
export function diagramFenceRenderer(inner: CodeRenderer): DiagramFenceRenderer {
  let drawn = 0;
  const code = (token: Tokens.Code): string => {
    if (infoWord(token.lang) !== MERMAID_LANG) return inner(token);
    drawn += 1;
    return diagramFence(token.text, inner(token));
  };
  return { code, drawn: () => drawn };
}

export const MERMAID_STYLE = [
  "pre.mermaid[data-mermaid-pending]{display:none}",
  ".mermaid-diagram{overflow:auto;margin:1rem 0}.mermaid-diagram svg{max-width:100%;height:auto}",
  "details.mermaid-source>summary{cursor:pointer;font-size:.85em;opacity:.7;margin:.25rem 0}",
  "pre.mermaid-error{white-space:pre-wrap;color:#b42318}",
].join("");

// The DOM is reached through the prototypes, as the reporter reaches it: a `.md` can shadow
// `document.querySelectorAll` with `<img name=…>`.
const bootstrapSource = (entryUrl: string, theme: MermaidTheme | null): string =>
  [
    `import mermaid from ${JSON.stringify(entryUrl)};`,
    `const theme = ${JSON.stringify(theme)} ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default');`,
    // `strict` keeps HTML in labels inert; `suppressErrorRendering` keeps mermaid from drawing its
    // own error graphic into the body, since the failed fence shows the error itself. `layout` and
    // `look` pin the pre-12 appearance, as the Canvas's renderer does.
    "mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme, layout: 'dagre', look: 'classic' });",
    "const pending = Array.from(Document.prototype.querySelectorAll.call(document, 'pre.mermaid[data-mermaid-pending]'));",
    // The pane loads the Markdown frame while the editor is up, `display:none`. A document with no
    // layout measures every text as 0x0, and mermaid draws an empty diagram on that or throws "svg
    // element not in render tree" — so nothing is drawn until the document has a width, and the
    // ResizeObserver is what reports the frame being shown (as the reporter's growth watch relies on).
    "const laidOut = () => document.documentElement.clientWidth > 0;",
    "const whenLaidOut = () => new Promise((resolve) => {",
    "  if (laidOut()) { resolve(); return; }",
    "  const watch = new ResizeObserver(() => { if (laidOut()) { watch.disconnect(); resolve(); } });",
    "  watch.observe(document.documentElement);",
    "});",
    "let attempts = 0;",
    "const draw = async (node) => {",
    "  const fence = node.parentElement;",
    "  try {",
    "    await whenLaidOut();",
    "    const { svg } = await mermaid.render('mt-mermaid-' + (attempts += 1), node.textContent || '');",
    "    const diagram = Document.prototype.createElement.call(document, 'div');",
    "    diagram.className = 'mermaid-diagram';",
    "    diagram.innerHTML = svg;",
    "    node.replaceWith(diagram);",
    "    if (fence) fence.querySelector('details.mermaid-source')?.removeAttribute('open');",
    "  } catch (err) {",
    // Hidden again between the wait and the render: that is the frame's doing, not the fence's.
    "    if (!laidOut()) { await whenLaidOut(); return draw(node); }",
    "    const box = Document.prototype.createElement.call(document, 'pre');",
    "    box.className = 'mermaid-error';",
    "    box.textContent = 'Mermaid: ' + String(err && err.message ? err.message : err);",
    "    node.replaceWith(box);",
    "  }",
    "};",
    "await Promise.all(pending.map(draw));",
  ].join("\n");

/** The module script that draws the diagrams, under the nonce the reporter runs with. A module so
 *  that it can `import` — and the import inherits the nonce, which is what lets mermaid in. */
export const mermaidBootstrapTag = (nonce: string, entryUrl: string, theme: MermaidTheme | null): string =>
  `<script type="module" nonce="${nonce}">${bootstrapSource(entryUrl, theme)}</script>`;
