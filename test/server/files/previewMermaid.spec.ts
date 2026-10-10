// @vitest-environment node
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { Marked, type Tokens } from "marked";
import {
  DIAGRAM_SOURCE_DEFAULT_LABEL,
  MERMAID_STYLE,
  diagramFence,
  diagramFenceRenderer,
  mermaidBootstrapTag,
  mermaidThemeFor,
} from "../../../server/files/previewMermaid";
import { numberedCodeRenderer } from "../../../server/files/previewCodeFence";
import { CODE_BLOCK_ATTR, previewCodeBlocks } from "../../../common/previewCodeBlocks";

// #2991. A mermaid fence in the Preview is drawn as the block it always was, with a hidden
// placeholder holding the source for the document's own module script. The block's number — what
// the copy button posts — must not move, and the script must take nothing from the file.

const inner = (token: Tokens.Code): string => `<pre><code>${token.text}</code></pre>`;
const fence = (lang: string | undefined, text: string): Tokens.Code => ({ type: "code", raw: "", text, ...(lang === undefined ? {} : { lang }) });

describe("diagramFenceRenderer", () => {
  it("leaves a fence of any other language, and one with none, to the inner renderer", () => {
    const renderer = diagramFenceRenderer(inner);
    expect(renderer.code(fence("ts", "x"))).toBe(inner(fence("ts", "x")));
    expect(renderer.code(fence(undefined, "x"))).toBe(inner(fence(undefined, "x")));
    expect(renderer.code(fence("mermaidjs", "x"))).toBe(inner(fence("mermaidjs", "x")));
    expect(renderer.drawn()).toBe(0);
  });

  it("draws a mermaid fence as the inner block inside an open disclosure, beside a placeholder holding the source", () => {
    const renderer = diagramFenceRenderer(inner);
    const html = renderer.code(fence("mermaid", "graph TD\n  A-->B"));
    expect(html).toBe(diagramFence("graph TD\n  A-->B", inner(fence("mermaid", "graph TD\n  A-->B"))));
    expect(html).toContain('<pre class="mermaid" data-mermaid-pending="1">graph TD\n  A--&gt;B</pre>');
    expect(html).toContain(
      `<details class="mermaid-source" open><summary>${DIAGRAM_SOURCE_DEFAULT_LABEL}</summary><pre><code>graph TD\n  A-->B</code></pre></details>`,
    );
    expect(renderer.drawn()).toBe(1);
  });

  // The language is the info string's first word, as the copy button's count names it.
  it.each([["mermaid  "], ['mermaid title="x"']])("matches the language by the info string's first word (%j)", (lang) => {
    const renderer = diagramFenceRenderer(inner);
    expect(renderer.code(fence(lang, "graph TD"))).toContain('data-mermaid-pending="1"');
    expect(renderer.drawn()).toBe(1);
  });

  // The placeholder is text the script reads back through `textContent`: every character the
  // markup could misread has to be an entity, and come back as itself.
  it("escapes the source in the placeholder", () => {
    const html = diagramFence('A["<b>&amp;</b>"] --> B', "");
    expect(html).toContain("A[&quot;&lt;b&gt;&amp;amp;&lt;/b&gt;&quot;] --&gt; B</pre>");
  });

  it("counts every mermaid fence it drew", () => {
    const renderer = diagramFenceRenderer(inner);
    ["mermaid", "ts", "mermaid", "mermaid"].forEach((lang) => renderer.code(fence(lang, "x")));
    expect(renderer.drawn()).toBe(3);
  });

  // Through the real numbering and the real lexer: the diagram's block keeps the number the pane
  // reads the file by, and the blocks after it are not renumbered.
  it("keeps the numbered block's number, wrapped and all", async () => {
    const md = "```mermaid\ngraph TD\n```\n\n```ts\nconst a = 1;\n```\n\n```mermaid\npie\n```\n";
    const renderer = diagramFenceRenderer(numberedCodeRenderer(() => null));
    const html = await new Marked({ renderer: { code: renderer.code } }).parse(md);
    const numbers = [...html.matchAll(new RegExp(`<pre ${CODE_BLOCK_ATTR}="(\\d+)"`, "g"))].map((match) => Number(match[1]));
    expect(numbers).toEqual([0, 1, 2]);
    expect(previewCodeBlocks(md).map((block) => block.lang)).toEqual(["mermaid", "ts", "mermaid"]);
    expect(html.match(/<details class="mermaid-source" open>/g)).toHaveLength(2);
    expect(renderer.drawn()).toBe(2);
  });
});

describe("mermaidThemeFor", () => {
  it("follows the pane's background, and leaves the reader's scheme to the document without one", () => {
    const theme = { bg: "#1a1a2e", fg: "#e6e6f0", muted: "#aaaaaa", subtle: "#222222", border: "#333333", link: "#4a8cff" };
    expect(mermaidThemeFor(theme)).toBe("dark");
    expect(mermaidThemeFor({ ...theme, bg: "#ffffff" })).toBe("default");
    expect(mermaidThemeFor(null)).toBeNull();
  });
});

describe("MERMAID_STYLE", () => {
  // Until the script replaces it, and in a document whose script never ran, the source is in the
  // block beside it — the placeholder must not show it a second time.
  it("hides the placeholder", () => {
    expect(MERMAID_STYLE).toContain("pre.mermaid[data-mermaid-pending]{display:none}");
  });
});

/** The script's own source, as the browser will see it once the element is parsed. */
const bootstrapSourceOf = (tag: string): string => tag.replace(/^<script type="module" nonce="[^"]*">/, "").replace(/<\/script>$/, "");

describe("mermaidBootstrapTag", () => {
  const ENTRY = "/api/files/mermaid/12.1.0/mermaid.esm.min.mjs";

  // A module, under the nonce: that is what lets it import, and the import inherits the nonce.
  it("is a module script carrying the nonce, importing the entry it was given", () => {
    const tag = mermaidBootstrapTag("n1", ENTRY, "dark");
    expect(tag.startsWith('<script type="module" nonce="n1">')).toBe(true);
    expect(tag).toContain(`import mermaid from "${ENTRY}";`);
  });

  it("tells mermaid the pane's theme, or asks the reader's scheme when there is none", () => {
    expect(bootstrapSourceOf(mermaidBootstrapTag("n1", ENTRY, "dark"))).toContain('const theme = "dark" ??');
    expect(bootstrapSourceOf(mermaidBootstrapTag("n1", ENTRY, null))).toContain("const theme = null ?? (matchMedia('(prefers-color-scheme: dark)')");
  });

  // mermaid's own error graphic would land in the body beside the fence's; and `strict` is what
  // keeps HTML written into a label inert.
  it("initialises mermaid without its error drawing and with HTML in labels kept inert", () => {
    const source = bootstrapSourceOf(mermaidBootstrapTag("n1", ENTRY, null));
    expect(source).toContain("suppressErrorRendering: true");
    expect(source).toContain("securityLevel: 'strict'");
    expect(source).toContain("startOnLoad: false");
  });

  // The pane loads the Markdown frame hidden (the editor is up), and a document with no layout
  // measures text as 0x0: mermaid then draws nothing, or throws. Drawing waits for the first layout,
  // and a render that failed while hidden again is retried rather than reported.
  it("draws nothing until the document has a width, and retries a render that failed hidden", () => {
    const source = bootstrapSourceOf(mermaidBootstrapTag("n1", ENTRY, null));
    expect(source).toContain("document.documentElement.clientWidth > 0");
    expect(source).toContain("new ResizeObserver(");
    expect(source.indexOf("await whenLaidOut();")).toBeLessThan(source.indexOf("mermaid.render("));
    expect(source).toContain("if (!laidOut()) { await whenLaidOut(); return draw(node); }");
  });

  // A failed fence keeps its block open with the error above it; a drawn one folds the block.
  it("folds the block under a drawn diagram and leaves it open under an error", () => {
    const source = bootstrapSourceOf(mermaidBootstrapTag("n1", ENTRY, null));
    expect(source).toContain("removeAttribute('open')");
    expect(source).toContain("box.className = 'mermaid-error'");
    expect(source.indexOf("removeAttribute('open')")).toBeLessThan(source.indexOf("catch (err)"));
  });

  // The script is a STRING here and a program in the browser: a syntax error would fail silently,
  // as a diagram that stays a code block.
  it("parses as a module", () => {
    const source = bootstrapSourceOf(mermaidBootstrapTag("n1", ENTRY, "default"));
    const result = ts.transpileModule(source, {
      reportDiagnostics: true,
      fileName: "bootstrap.js",
      compilerOptions: { allowJs: true, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    expect(result.diagnostics ?? []).toEqual([]);
  });
});
