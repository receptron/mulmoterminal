<script setup lang="ts">
// Full-screen read-only wiki browser, the no-router-content sibling of
// CollectionsBrowseOverlay / AccountingOverlay. Driven by useWikiBrowse: the URL picks
// the view (index / page / graph / lint) and this overlay fetches the matching data
// from the read-only /api/wiki surface and renders the native sub-view. No writes, no
// snapshots — Claude authors the wiki in the terminal; this only browses.
//
// Data is re-fetched on every view entry (the shared workspace changes underfoot as
// the terminal Claude edits pages), so the browser never shows a stale page/graph.
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { WikiGraph } from "@mulmoclaude/core/wiki";
import { useWikiBrowse, wikiGotoIndex, wikiGotoGraph, wikiGotoLint, type WikiView } from "../composables/useWikiBrowse";
import { fetchWikiIndex, fetchWikiGraph, fetchWikiPage, fetchWikiLint, type WikiIndex, type WikiPage, type WikiLint } from "../wikiApi";
import { renderWikiHtml } from "../wikiMarkdown";
import WikiIndexView from "./WikiIndexView.vue";
import WikiPageView from "./WikiPageView.vue";
import WikiGraphView from "./WikiGraphView.vue";

const { view, isOpen, close } = useWikiBrowse();

const index = ref<WikiIndex | null>(null);
const graph = ref<WikiGraph | null>(null);
const page = ref<WikiPage | null>(null);
const lint = ref<WikiLint | null>(null);
const lintHtml = ref("");
const loading = ref(false);
const error = ref<string | null>(null);

// A monotonic token guards against out-of-order responses when the user navigates
// faster than fetches resolve — only the latest request gets to commit its result.
let reqId = 0;

// Per-mode fetchers. Each does its async work, then returns a `commit` closure that
// writes the result into the refs — the watcher runs the commit ONLY if this is still
// the latest request, so a slow response from an abandoned view can never overwrite a
// newer one. Splitting them out also keeps the watcher a flat dispatch (low complexity).
type Commit = () => void;
async function loadIndex(): Promise<Commit> {
  const res = await fetchWikiIndex();
  return () => (index.value = res);
}
async function loadPage(slug: string): Promise<Commit> {
  const [p, g] = await Promise.all([fetchWikiPage(slug), fetchWikiGraph()]);
  return () => {
    page.value = p;
    graph.value = g;
  };
}
async function loadGraph(): Promise<Commit> {
  const g = await fetchWikiGraph();
  return () => (graph.value = g);
}
async function loadLint(): Promise<Commit> {
  const l = await fetchWikiLint();
  return () => {
    lint.value = l;
    lintHtml.value = renderWikiHtml(l.report);
  };
}

function fetchForView(v: WikiView): Promise<Commit> {
  switch (v.mode) {
    case "index":
      return loadIndex();
    case "page":
      return loadPage(v.slug);
    case "graph":
      return loadGraph();
    case "lint":
      return loadLint();
    default:
      return Promise.resolve(() => {});
  }
}

watch(
  view,
  async (v) => {
    if (v.mode === "closed") return;
    const id = ++reqId;
    error.value = null;
    loading.value = true;
    try {
      const commit = await fetchForView(v);
      if (id === reqId) commit();
    } catch (e) {
      if (id === reqId) error.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (id === reqId) loading.value = false;
    }
  },
  { immediate: true },
);

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && isOpen.value) close();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="isOpen" class="wiki-overlay" role="region" aria-label="Wiki">
    <nav class="wiki-tabs" aria-label="Wiki sections">
      <button type="button" :class="{ active: view.mode === 'index' }" @click="wikiGotoIndex">Index</button>
      <button v-if="view.mode === 'page'" type="button" class="active" aria-current="page" disabled>
        {{ page?.resolvedTitle ?? "Page" }}
      </button>
      <button type="button" :class="{ active: view.mode === 'graph' }" @click="wikiGotoGraph">Graph</button>
      <button type="button" :class="{ active: view.mode === 'lint' }" @click="wikiGotoLint">Lint</button>
    </nav>
    <div class="wiki-content">
      <p v-if="error" class="wiki-msg wiki-error">{{ error }}</p>
      <p v-else-if="loading" class="wiki-msg">Loading…</p>
      <template v-else>
        <WikiIndexView v-if="view.mode === 'index' && index" :entries="index.entries" />
        <WikiPageView v-else-if="view.mode === 'page' && page" :slug="view.slug" :page="page" :graph="graph" />
        <WikiGraphView v-else-if="view.mode === 'graph' && graph" :graph="graph" />
        <!-- eslint-disable-next-line vue/no-v-html -- sanitized in renderWikiHtml -->
        <div v-else-if="view.mode === 'lint'" class="wiki-lint" v-html="lintHtml"></div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Fills the page BELOW the toolbar (40px) — the toolbar stays visible + clickable so
   the user can switch back to Chat. Matches the other overlays. */
.wiki-overlay {
  position: fixed;
  top: 40px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  background: var(--bg-deep);
  display: flex;
  flex-direction: column;
}
.wiki-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.wiki-tabs button {
  padding: 4px 12px;
  font-size: 13px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wiki-tabs button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.wiki-tabs button.active {
  background: var(--accent-bg);
  color: var(--on-accent);
  cursor: default;
}
.wiki-content {
  flex: 1 1 auto;
  overflow-y: auto;
}
.wiki-msg {
  padding: 48px 28px;
  text-align: center;
  color: var(--text-muted);
}
.wiki-error {
  color: var(--err);
}
.wiki-lint {
  max-width: 820px;
  margin: 0 auto;
  padding: 24px 28px 64px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.6;
}
.wiki-lint :deep(h1),
.wiki-lint :deep(h2) {
  font-weight: 650;
  margin: 1.2em 0 0.4em;
}
.wiki-lint :deep(code) {
  background: var(--bg-subtle);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
</style>
