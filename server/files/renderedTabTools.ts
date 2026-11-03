// The toolbar a rendered document carries when it opens in a TAB of its own (#3238): a switch
// between the rendering and the file's source, and a copy button for each. The Files pane's
// Preview never gets it — the pane has an editor and a copy of its own — so the route adds it only
// to the document nobody embeds.
//
// That document had always run nothing. Copying needs a script, so the tab takes the policy the
// embeddable document already has (mdPreviewEmbed.ts): `sandbox allow-scripts` with a per-response
// nonce that admits this one script and none the file contains. Two things keep that true and are
// pinned by this module's spec: the script is one constant with nothing from the file in it, and
// the labels reach it through the document's own attributes, never through the source.
//
// Pure: strings in, strings out. The route owns the nonce and the language.
import { escapeHtml, htmlDoc } from "./renderedDoc.js";

/** What the route rendered: decides what the rendering is called on the buttons. */
export type RenderedKind = "markdown" | "json" | "table";

export const TAB_TOOL_LANGUAGES = ["en", "ja", "ko", "zh-CN", "zh-TW"] as const;
export type TabToolLanguage = (typeof TAB_TOOL_LANGUAGES)[number];
const isTabToolLanguage = (value: unknown): value is TabToolLanguage => TAB_TOOL_LANGUAGES.some((language) => language === value);

interface LabelSet {
  rendered: Record<RenderedKind, string>;
  source: string;
  copySource: string;
  copyRendered: Record<RenderedKind, string>;
  copied: string;
  copyFailed: string;
  toolbar: string;
}

const LABELS: Record<TabToolLanguage, LabelSet> = {
  en: {
    rendered: { markdown: "Preview", json: "Formatted", table: "Table" },
    source: "Source",
    copySource: "Copy source",
    copyRendered: { markdown: "Copy preview", json: "Copy formatted", table: "Copy table" },
    copied: "Copied",
    copyFailed: "Could not copy. Select the text and copy it yourself.",
    toolbar: "View and copy",
  },
  ja: {
    rendered: { markdown: "プレビュー", json: "整形表示", table: "表" },
    source: "ソース",
    copySource: "ソースをコピー",
    copyRendered: { markdown: "プレビューをコピー", json: "整形表示をコピー", table: "表をコピー" },
    copied: "コピーしました",
    copyFailed: "コピーできませんでした。テキストを選択して、ご自身でコピーしてください。",
    toolbar: "表示とコピー",
  },
  ko: {
    rendered: { markdown: "미리보기", json: "정렬된 보기", table: "표" },
    source: "원본",
    copySource: "원본 복사",
    copyRendered: { markdown: "미리보기 복사", json: "정렬된 보기 복사", table: "표 복사" },
    copied: "복사했습니다",
    copyFailed: "복사할 수 없습니다. 텍스트를 선택해 직접 복사하세요.",
    toolbar: "보기와 복사",
  },
  "zh-CN": {
    rendered: { markdown: "预览", json: "格式化", table: "表格" },
    source: "源文本",
    copySource: "复制源文本",
    copyRendered: { markdown: "复制预览", json: "复制格式化内容", table: "复制表格" },
    copied: "已复制",
    copyFailed: "无法复制。请选中文本后自行复制。",
    toolbar: "查看与复制",
  },
  "zh-TW": {
    rendered: { markdown: "預覽", json: "格式化", table: "表格" },
    source: "原始文字",
    copySource: "複製原始文字",
    copyRendered: { markdown: "複製預覽", json: "複製格式化內容", table: "複製表格" },
    copied: "已複製",
    copyFailed: "無法複製。請選取文字後自行複製。",
    toolbar: "檢視與複製",
  },
};

export interface TabToolLabels {
  rendered: string;
  source: string;
  copySource: string;
  copyRendered: string;
  copied: string;
  copyFailed: string;
  toolbar: string;
}

/** The labels for a document of `kind`, in `language` when it is one of ours and in English
 *  otherwise. The language is whatever the request negotiated: the tab is a document on its own
 *  and cannot ask the app which language is on, as it cannot ask which theme is. */
export function tabToolLabelsFor(language: unknown, kind: RenderedKind): TabToolLabels {
  const set = LABELS[isTabToolLanguage(language) ? language : "en"];
  return {
    rendered: set.rendered[kind],
    source: set.source,
    copySource: set.copySource,
    copyRendered: set.copyRendered[kind],
    copied: set.copied,
    copyFailed: set.copyFailed,
    toolbar: set.toolbar,
  };
}

// The script never looks an element up by id or class across the document: the file's own HTML
// lands inside the rendering, and raw HTML in Markdown can close the rendering's wrapper and put
// elements of its own beside it, repeating any id or class. What the file cannot do is put anything
// BEFORE the wrapper, so the shell emits the toolbar, the source and the wrapper first and the
// script reads them as the first four children of <body> — itself the third, which it checks against
// `currentScript`.
/** The source as a JSON string in a data block, for the copies to read: the <pre> that SHOWS it
 *  goes through the HTML parser, which turns CRLF into LF and U+0000 into U+FFFD before any script
 *  can read it, so a file is copied "as it is" only from text the parser never touches. A data
 *  block (`type="application/json"`) is never executed, so it needs no nonce and admits nothing;
 *  `<` is written as `\u003c` so that no `</script` in the file can end the block early. */
const sourceDataHtml = (source: string): string =>
  `<script type="application/json" data-tab-source>${JSON.stringify(source).replace(/</g, "\\u003c")}</script>`;

const toolbarHtml = (labels: TabToolLabels, source: string): string =>
  [
    `<div class="tab-tools" role="toolbar" aria-label="${escapeHtml(labels.toolbar)}">`,
    sourceDataHtml(source),
    `<span class="tab-tools-view">`,
    `<button type="button" data-show="rendered" aria-pressed="true">${escapeHtml(labels.rendered)}</button>`,
    `<button type="button" data-show="source" aria-pressed="false">${escapeHtml(labels.source)}</button>`,
    `</span>`,
    `<button type="button" data-copy="source">${escapeHtml(labels.copySource)}</button>`,
    `<button type="button" data-copy="rendered">${escapeHtml(labels.copyRendered)}</button>`,
    `<span class="tab-tools-status" role="status" aria-live="polite" data-copied="${escapeHtml(labels.copied)}" data-failed="${escapeHtml(labels.copyFailed)}"></span>`,
    `</div>`,
  ].join("");

const TOOLS_STYLE = [
  ".tab-tools{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:0 0 1rem;padding:0 0 .5rem;border-bottom:1px solid #d0d0d8;font-size:13px}",
  ".tab-tools button{font:inherit;padding:.25rem .6rem;border:1px solid #d0d0d8;border-radius:.4rem;background:transparent;color:inherit;cursor:pointer}",
  ".tab-tools button[aria-pressed=true]{background:#e4e4ea}",
  ".tab-tools-view{display:inline-flex}.tab-tools-view button:first-child{border-radius:.4rem 0 0 .4rem}.tab-tools-view button:last-child{border-radius:0 .4rem .4rem 0;margin-left:-1px}",
  ".tab-tools-status{color:#55555f}",
  "#tab-source{white-space:pre-wrap;overflow-wrap:anywhere}",
  "@media(prefers-color-scheme:dark){.tab-tools{border-bottom-color:#3a3a44}.tab-tools button{border-color:#3a3a44}.tab-tools button[aria-pressed=true]{background:#2a2a32}.tab-tools-status{color:#a0a0aa}}",
].join("");

/** How long the copy notice stays up. */
const COPIED_NOTICE_MS = 1500;

/** The toolbar's script, as it is written into the document. One constant: nothing from the file
 *  and no label is interpolated, so the only thing a response adds to it is the nonce on its tag.
 *
 *  Its elements are the first four children of <body> — the toolbar, the source, this script, the
 *  rendering's wrapper — checked for the shell's own marks, and the script knows itself as
 *  `currentScript`. It sits BEFORE the rendering so that no raw HTML in the file can swallow it:
 *  an unclosed <textarea>, <style> or <title> turns everything after itself into text, and a
 *  script placed after the rendering would never run. Being before the rendering, it waits for
 *  the parser to finish before it looks. Buttons and the source's data block are looked for
 *  inside the toolbar only. The rendering is every element from the wrapper to the end of <body>:
 *  raw HTML in the file may have closed the wrapper early, and what follows it is still the
 *  rendering, shown and hidden and copied with it. The text both source copies hand over comes
 *  from the data block, never from the <pre> (see sourceDataHtml).
 *
 *  Copying tries the Clipboard API first — `write` with both the text as shown and the HTML, so a
 *  rich editor keeps the headings and a plain field gets the words — and falls back to a selection
 *  and `execCommand("copy")`, which is what a page without a clipboard (plain http on a LAN
 *  address) or a refused write still has. For the source that selection is a textarea holding the
 *  exact text: selecting the element's contents instead ends at its last character and loses the
 *  file's final newline. A view the reader is not looking at has no layout and so no line breaks
 *  in its text, and a clone of it carries its `hidden`, so what the script hid is shown for the
 *  moment of the read.
 *
 *  What is hidden is hidden by an inline `display: none !important` as well as by `hidden`: raw HTML
 *  in the file can carry a stylesheet, and an author `[hidden]{display:block}` beats the browser's
 *  default rule, which would leave both views on screen. The script touches only what IT hid: the
 *  element's own style attribute and its own `hidden`, if the file gave it one, are recorded when it
 *  is hidden and put back as they were, and an element the file itself hid is left alone — in the
 *  switch, in the copies, byte for byte. The elements beside the wrapper are the file's, and a <form> among them
 *  shadows any property or method with an <input name=…> of that name (DOM clobbering: `el.style`
 *  is then the input), so they are read and written through the prototypes, never through the
 *  element. */
const TOOLS_SCRIPT = `(() => {
  const script = document.currentScript;
  const ready = () => {
  const [toolbar, source, self, rendered] = document.body.children;
  if (!script || self !== script || !toolbar || !source || !rendered) return;
  if (!toolbar.classList.contains("tab-tools") || source.id !== "tab-source" || rendered.id !== "tab-rendered") return;
  const status = toolbar.querySelector(".tab-tools-status");
  const data = toolbar.querySelector("script[data-tab-source]");
  if (!status || !data) return;
  const sourceText = JSON.parse(data.textContent ?? '""');
  if (typeof sourceText !== "string") return;
  const getter = (proto, name) => Object.getOwnPropertyDescriptor(proto, name).get;
  const nextElement = getter(Element.prototype, "nextElementSibling");
  const innerTextOf = getter(HTMLElement.prototype, "innerText");
  const textContentOf = getter(Node.prototype, "textContent");
  const { getAttribute, setAttribute, removeAttribute, hasAttribute } = Element.prototype;
  const renderedNodes = () => {
    const nodes = [];
    for (let el = rendered; el; el = nextElement.call(el)) nodes.push(el);
    return nodes;
  };
  const own = new Map();
  own.set(source, [null, false]);
  const setHidden = (el, hide) => {
    if (hide) {
      if (!own.has(el)) own.set(el, [getAttribute.call(el, "style"), hasAttribute.call(el, "hidden")]);
      const [style] = own.get(el);
      setAttribute.call(el, "style", (style ? style + ";" : "") + "display:none !important");
      setAttribute.call(el, "hidden", "");
      return;
    }
    const was = own.get(el);
    if (!was) return;
    own.delete(el);
    if (was[0] === null) removeAttribute.call(el, "style");
    else setAttribute.call(el, "style", was[0]);
    if (!was[1]) removeAttribute.call(el, "hidden");
  };
  const show = (name) => {
    setHidden(source, name !== "source");
    for (const el of renderedNodes()) setHidden(el, name !== "rendered");
    for (const b of toolbar.querySelectorAll("[data-show]")) b.setAttribute("aria-pressed", String(b.dataset.show === name));
  };
  let timer = 0;
  const say = (text) => {
    status.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => { status.textContent = ""; }, ${COPIED_NOTICE_MS});
  };
  const whileShown = (els, read) => {
    const lifted = els.filter((el) => own.has(el));
    lifted.forEach((el) => setHidden(el, false));
    try { return read(); } finally { lifted.forEach((el) => setHidden(el, true)); }
  };
  const renderedRange = () => {
    const range = document.createRange();
    range.setStartBefore(rendered);
    range.setEnd(document.body, document.body.childNodes.length);
    return range;
  };
  const renderedHtml = () => whileShown(renderedNodes(), () => {
    const box = document.createElement("div");
    box.append(renderedRange().cloneContents());
    return box.innerHTML;
  });
  const renderedText = () => {
    const nodes = renderedNodes();
    return whileShown(nodes, () => nodes.map((el) => (el instanceof HTMLElement ? innerTextOf : textContentOf).call(el)).join("\\n"));
  };
  const copySelection = (select) => {
    const selection = getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    select(selection);
    try { return document.execCommand("copy"); } finally { selection.removeAllRanges(); }
  };
  const selectAndCopy = (name) => {
    if (name === "source") {
      const area = document.createElement("textarea");
      area.value = sourceText;
      area.setAttribute("aria-hidden", "true");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      try { return copySelection(() => area.select()); } finally { area.remove(); }
    }
    return whileShown(renderedNodes(), () => copySelection((selection) => selection.addRange(renderedRange())));
  };
  const write = (name) => {
    if (name === "source") return navigator.clipboard.writeText(sourceText);
    const text = renderedText();
    if (typeof ClipboardItem !== "function") return navigator.clipboard.writeText(text);
    const item = new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([renderedHtml()], { type: "text/html" }) });
    return navigator.clipboard.write([item]);
  };
  const copy = async (name) => {
    try {
      await write(name);
      say(status.dataset.copied ?? "");
    } catch {
      say(selectAndCopy(name) ? status.dataset.copied ?? "" : status.dataset.failed ?? "");
    }
  };
  for (const b of toolbar.querySelectorAll("[data-show]")) b.addEventListener("click", () => show(b.dataset.show));
  for (const b of toolbar.querySelectorAll("[data-copy]")) b.addEventListener("click", () => { void copy(b.dataset.copy); });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();`;

export interface RenderedTabDoc {
  /** The rendering, as the route built it. */
  html: string;
  /** The file's text as it is, shown escaped and copied as it is. */
  source: string;
  title: string;
  /** The route's own style for the rendering, appended after the shared sheet. */
  style: string;
  nonce: string;
  labels: TabToolLabels;
}

/** The tab's document: the toolbar, the source (hidden until asked for — by the attribute and by an
 *  inline display the file's own stylesheet cannot undo, see TOOLS_SCRIPT), the one script and then
 *  the rendering, in the shared shell. The order is the script's contract (see TOOLS_SCRIPT):
 *  everything the shell owns comes before the first byte of the file's rendering, the script
 *  included. */
export function renderedTabDoc({ html, source, title, style, nonce, labels }: RenderedTabDoc): string {
  const body = [
    toolbarHtml(labels, source),
    `<pre id="tab-source" hidden style="display:none !important"><code>${escapeHtml(source)}</code></pre>`,
    `<script nonce="${nonce}">${TOOLS_SCRIPT}</script>`,
    `<div id="tab-rendered">${html}</div>`,
  ].join("");
  return htmlDoc(body, title, style + TOOLS_STYLE);
}
