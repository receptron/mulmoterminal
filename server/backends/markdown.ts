// MarkdownHostApp backend for the @mulmoclaude/markdown-plugin presentDocument
// plugin (task #6 Phase 4). The package's View reaches these via
// useRuntime().dispatch({ kind }) → POST /api/plugin/presentDocument →
// execute({ app }, args) → context.app.<method> (plugins-registry.ts injects
// this into APP_CONTEXT). The package's create path also calls fillImages +
// saveNewDoc here.
//
// MulmoTerminal specifics vs MulmoClaude:
//   - Docs are plain files under <workspace>/artifacts/documents/YYYY/MM/ — the
//     `artifacts/documents/` prefix is what the package's isFilePath() recognises,
//     so the View loads/saves/live-refreshes them.
//   - Images come back as base64 data URIs from Gemini (no image store / serving
//     route), inlined straight into the markdown — so fillImages needs no storage
//     and PDF export needs no image-resolution step.
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { marked } from "marked";
import { renderMarpDeck, fillImagePlaceholders } from "@mulmoclaude/markdown-plugin";
import type { MarkdownHostApp, ExportPdfOptions } from "@mulmoclaude/markdown-plugin";
import type { createPubSub } from "../pubsub.js";
import { generateImage } from "./image-gen.js";

type PubSub = ReturnType<typeof createPubSub>;

const DOCS_DIR = "artifacts/documents";

// Set once at boot (server/index.ts) — workspace = CLAUDE_CWD, pubsub for
// live-refresh forwarding to the plugin-scoped channel.
let workspace: string | null = null;
let pubsub: PubSub | null = null;

export function initMarkdownBackend(deps: { workspace: string; pubsub: PubSub | null }): void {
  workspace = deps.workspace;
  pubsub = deps.pubsub ?? null;
}

// Strict gate (matches the package's isFilePath + MulmoClaude's isMarkdownPath):
// only `artifacts/documents/**.md`, normalized, no traversal.
function isDocPath(rel: string): boolean {
  if (!rel.startsWith(`${DOCS_DIR}/`) || !rel.endsWith(".md")) return false;
  const normalized = path.posix.normalize(rel);
  return normalized === rel && !normalized.includes("..");
}

function absFor(rel: string): string {
  if (!workspace) throw new Error("markdown backend not initialised (missing workspace)");
  return path.join(workspace, rel);
}

function sanitizePrefix(prefix: string): string {
  const cleaned = String(prefix || "document")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    // Runs are already collapsed to a single "-" above, so trim one at each end
    // (no quantifier — keeps the regex trivially linear).
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return cleaned || "document";
}

function buildNewDocPath(prefix: string): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = randomUUID().slice(0, 8);
  return `${DOCS_DIR}/${yyyy}/${mm}/${sanitizePrefix(prefix)}-${rand}.md`;
}

function publishFileChange(rel: string): void {
  // The package View subscribes via runtime.pubsub "file:<path>" →
  // "plugin:markdown:file:<path>". Forward self-saves so other tabs refresh.
  pubsub?.publish(`plugin:markdown:file:${rel}`, { path: rel, mtimeMs: Date.now() });
}

const MARKDOWN_PDF_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #1f2937; max-width: 800px; margin: 0 auto; padding: 32px 48px; }
  h1 { font-size: 1.75rem; } h2 { font-size: 1.25rem; border-bottom: 1px solid #e5e7eb; padding-bottom: .25rem; } h3 { font-size: 1rem; }
  pre { background: #f3f4f6; padding: .75rem; border-radius: .375rem; overflow-x: auto; } code { background: #f3f4f6; padding: .1rem .3rem; border-radius: .25rem; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #e5e7eb; padding: .5rem .75rem; } a { color: #2563eb; } img { max-width: 100%; height: auto; }
`;

export const markdownHostApp: MarkdownHostApp = {
  async loadDoc(rel) {
    if (!isDocPath(rel)) throw new Error(`invalid document path: ${rel}`);
    const content = await fs.promises.readFile(absFor(rel), "utf8");
    return { content };
  },

  async saveDoc(rel, markdown) {
    if (!isDocPath(rel)) throw new Error(`invalid document path: ${rel}`);
    await fs.promises.writeFile(absFor(rel), markdown);
    publishFileChange(rel);
    return { path: rel };
  },

  async saveNewDoc(prefix, markdown) {
    const rel = buildNewDocPath(prefix);
    const abs = absFor(rel);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, markdown);
    return { path: rel };
  },

  async marpThemes() {
    // No workspace Marp themes in MulmoTerminal yet — decks use Marp's built-ins.
    return { themes: [] };
  },

  async fillImages(markdown) {
    const { markdown: filled } = await fillImagePlaceholders(markdown, {
      // Gemini returns a base64 data URI in result.data.imageData; inline it
      // directly (no image store). null → the package leaves a text marker.
      resolveImage: async (prompt) => {
        const result = await generateImage(prompt);
        return "data" in result && result.data ? result.data.imageData : null;
      },
    });
    return { markdown: filled };
  },

  async exportPdf(options: ExportPdfOptions) {
    // Lazy-load puppeteer so the server still boots when it isn't installed
    // (heavy Chromium dep). Images are already data URIs in the markdown, so no
    // image-resolution step is needed before printing.
    let puppeteerMod: typeof import("puppeteer");
    try {
      puppeteerMod = await import("puppeteer");
    } catch {
      throw new Error("PDF export requires puppeteer (not installed on this server)");
    }
    const browser = await puppeteerMod.default.launch({ headless: true });
    try {
      const page = await browser.newPage();
      let pdf: Uint8Array;
      if (options.marp) {
        const { html, css, slideWidth, slideHeight } = await renderMarpDeck(options.markdown, { themes: [], inlineSVG: true });
        const fullHtml = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:white}${css}
div.marpit > svg > foreignObject > section img:not([data-marp-twemoji]){max-width:100%;max-height:60cqh;object-fit:contain}
</style></head><body>${html}</body></html>`;
        await page.setViewport({ width: slideWidth, height: slideHeight });
        await page.setContent(fullHtml, { waitUntil: "load" });
        pdf = await page.pdf({ width: `${slideWidth}px`, height: `${slideHeight}px`, margin: { top: "0", bottom: "0", left: "0", right: "0" }, printBackground: true });
      } else {
        const body = await marked.parse(options.markdown);
        const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${MARKDOWN_PDF_CSS}</style></head><body>${body}</body></html>`;
        await page.setContent(fullHtml, { waitUntil: "load" });
        pdf = await page.pdf({ format: options.format === "A4" ? "A4" : "Letter", margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" }, printBackground: true });
      }
      return { pdfBase64: Buffer.from(pdf).toString("base64") };
    } finally {
      await browser.close();
    }
  },
};
