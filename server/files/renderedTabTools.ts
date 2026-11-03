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

// The script finds every element it touches as a direct child of <body> (or under one), never by
// id alone: the file's own HTML lands INSIDE the rendered view, so an id it happens to repeat is a
// descendant and `body > #…` never answers with it.
const toolbarHtml = (labels: TabToolLabels): string =>
  [
    `<div class="tab-tools" role="toolbar" aria-label="${escapeHtml(labels.toolbar)}">`,
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
 *  Copying tries the Clipboard API first — `write` with both the text as shown and the HTML, so a
 *  rich editor keeps the headings and a plain field gets the words — and falls back to selecting
 *  the element and `execCommand("copy")`, which is what a page without a clipboard (plain http on
 *  a LAN address) or a refused write still has. A view the reader is not looking at has no layout
 *  and so no line breaks in its text, so it is shown for the moment of the read. */
const TOOLS_SCRIPT = `(() => {
  const rendered = document.querySelector("body > #tab-rendered");
  const source = document.querySelector("body > #tab-source");
  const status = document.querySelector("body > .tab-tools .tab-tools-status");
  if (!rendered || !source || !status) return;
  const views = { rendered, source };
  const show = (name) => {
    for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
    for (const b of document.querySelectorAll("body > .tab-tools [data-show]")) b.setAttribute("aria-pressed", String(b.dataset.show === name));
  };
  let timer = 0;
  const say = (text) => {
    status.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => { status.textContent = ""; }, ${COPIED_NOTICE_MS});
  };
  const whileShown = (el, read) => {
    const hidden = el.hidden;
    el.hidden = false;
    try { return read(); } finally { el.hidden = hidden; }
  };
  const selectAndCopy = (el) => whileShown(el, () => {
    const selection = getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    try { return document.execCommand("copy"); } finally { selection.removeAllRanges(); }
  });
  const write = (name) => {
    const el = views[name];
    if (name === "source") return navigator.clipboard.writeText(el.textContent ?? "");
    const text = whileShown(el, () => el.innerText);
    if (typeof ClipboardItem !== "function") return navigator.clipboard.writeText(text);
    const item = new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([el.innerHTML], { type: "text/html" }) });
    return navigator.clipboard.write([item]);
  };
  const copy = async (name) => {
    try {
      await write(name);
      say(status.dataset.copied ?? "");
    } catch {
      say(selectAndCopy(views[name]) ? status.dataset.copied ?? "" : status.dataset.failed ?? "");
    }
  };
  for (const b of document.querySelectorAll("body > .tab-tools [data-show]")) b.addEventListener("click", () => show(b.dataset.show));
  for (const b of document.querySelectorAll("body > .tab-tools [data-copy]")) b.addEventListener("click", () => { void copy(b.dataset.copy); });
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

/** The tab's document: the toolbar, the rendering, the source (hidden until asked for) and the one
 *  script, in the shared shell. */
export function renderedTabDoc({ html, source, title, style, nonce, labels }: RenderedTabDoc): string {
  const body = [
    toolbarHtml(labels),
    `<div id="tab-rendered">${html}</div>`,
    `<pre id="tab-source" hidden><code>${escapeHtml(source)}</code></pre>`,
    `<script nonce="${nonce}">${TOOLS_SCRIPT}</script>`,
  ].join("");
  return htmlDoc(body, title, style + TOOLS_STYLE);
}
