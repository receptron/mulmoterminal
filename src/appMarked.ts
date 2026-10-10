// The marked instance this app's own markdown renderers use (`markdownProse.ts`, `wikiMarkdown.ts`).
//
// An instance of its own rather than the global `marked`, because the global one is not ours: the
// markdown plugin's View calls `marked.use(...)` on it every time it mounts (copy buttons, maths,
// mermaid). Rendering through the global made a reply render one way before a document had been
// opened on the canvas and another way after it.
//
// What it adds is the code-block copy button MulmoClaude ships (#2998), plus the raw-HTML rule that
// goes with that button: an author's `class` / `style` could lay a decoy over a block, so the reader
// sees one command while the button copies another (receptron/mulmoclaude#3151).
import { Marked } from "marked";
import { codeCopyExtension, setCodeCopyLabelProvider, type CodeCopyLabels } from "@mulmoclaude/markdown-utils/markdown/codeCopyExtension";
import { installCodeCopyHandler } from "@mulmoclaude/markdown-utils/markdown/codeCopyClipboard";
import { rawHtmlPolicyExtension } from "@mulmoclaude/markdown-utils/markdown/rawHtmlPolicy";
import { i18n } from "./i18n";

export const appMarked = new Marked(rawHtmlPolicyExtension, codeCopyExtension);

/** Markdown to HTML, synchronously. `{ async: false }` still declares `string | Promise<string>`;
 *  checked rather than asserted, so a future default flip cannot hand DOMPurify a Promise (which
 *  sanitizes to the string "[object Promise]"). */
export function parseMarkdown(markdown: string): string {
  // The label provider is module state shared with the markdown plugin, which installs its own
  // whenever its View mounts (and has no `zh-CN` / `zh-TW`). Set ours for the render it labels.
  setCodeCopyLabelProvider(appCodeCopyLabels);
  const parsed = appMarked.parse(markdown, { async: false });
  return typeof parsed === "string" ? parsed : "";
}

/** Read inside the render, so a language switch relabels the buttons on the next one. */
const appCodeCopyLabels = (): CodeCopyLabels => ({
  copy: i18n.global.t("markdownCodeCopy.copyLabel"),
  copied: i18n.global.t("markdownCodeCopy.copiedLabel"),
});

/** Starts the one document-wide click listener that copies. */
export function installMarkdownCodeCopy(doc: Document): void {
  installCodeCopyHandler(doc);
}
