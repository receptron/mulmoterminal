<script setup lang="ts">
// Full-screen read-only wiki browser, the no-router-content sibling of
// CollectionsBrowseOverlay / AccountingOverlay. Driven by useWikiBrowse: the URL picks
// the view (index / page / graph / lint) and this overlay fetches the matching data
// from the read-only /api/wiki surface and renders the native sub-view. No writes, no
// snapshots — Claude authors the wiki in the terminal; this only browses.
//
// Data is re-fetched on every view entry (the shared workspace changes underfoot as
// the terminal Claude edits pages), so the browser never shows a stale page/graph.
import { ref, watch } from "vue";
import type { WikiGraph } from "@mulmoclaude/core/wiki";
import { useWikiBrowse, wikiGotoIndex, wikiGotoGraph, wikiGotoLint, type WikiView } from "../composables/useWikiBrowse";
import { useEscapeToClose } from "../composables/useEscapeToClose";
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

useEscapeToClose(isOpen, close);
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 bg-deep flex flex-col" role="region" aria-label="Wiki">
    <nav class="flex flex-none gap-1 border-b border-border bg-panel px-4 py-2" aria-label="Wiki sections">
      <button
        type="button"
        class="max-w-[280px] truncate rounded-md border-0 px-3 py-1 text-[13px]"
        :class="
          view.mode === 'index'
            ? 'cursor-default bg-accent-bg text-on-accent'
            : 'cursor-pointer bg-transparent text-muted enabled:hover:bg-hover enabled:hover:text-fg'
        "
        @click="wikiGotoIndex"
      >
        Index
      </button>
      <button
        v-if="view.mode === 'page'"
        type="button"
        class="max-w-[280px] cursor-default truncate rounded-md border-0 bg-accent-bg px-3 py-1 text-[13px] text-on-accent"
        aria-current="page"
        disabled
      >
        {{ page?.resolvedTitle ?? "Page" }}
      </button>
      <button
        type="button"
        class="max-w-[280px] truncate rounded-md border-0 px-3 py-1 text-[13px]"
        :class="
          view.mode === 'graph'
            ? 'cursor-default bg-accent-bg text-on-accent'
            : 'cursor-pointer bg-transparent text-muted enabled:hover:bg-hover enabled:hover:text-fg'
        "
        @click="wikiGotoGraph"
      >
        Graph
      </button>
      <button
        type="button"
        class="max-w-[280px] truncate rounded-md border-0 px-3 py-1 text-[13px]"
        :class="
          view.mode === 'lint'
            ? 'cursor-default bg-accent-bg text-on-accent'
            : 'cursor-pointer bg-transparent text-muted enabled:hover:bg-hover enabled:hover:text-fg'
        "
        @click="wikiGotoLint"
      >
        Lint
      </button>
    </nav>
    <div class="flex-auto overflow-y-auto">
      <p v-if="error" class="px-7 py-12 text-center text-err">{{ error }}</p>
      <p v-else-if="loading" class="px-7 py-12 text-center text-muted">Loading…</p>
      <template v-else>
        <WikiIndexView v-if="view.mode === 'index' && index" :entries="index.entries" />
        <WikiPageView v-else-if="view.mode === 'page' && page" :slug="view.slug" :page="page" :graph="graph" />
        <WikiGraphView v-else-if="view.mode === 'graph' && graph" :graph="graph" />
        <!-- eslint-disable-next-line vue/no-v-html -- sanitized in renderWikiHtml -->
        <div class="wiki-lint mx-auto max-w-[820px] px-7 pt-6 pb-16 text-[14px] leading-[1.6] text-fg" v-else-if="view.mode === 'lint'" v-html="lintHtml"></div>
      </template>
    </div>
  </div>
</template>

<!-- Only the lint markdown body stays scoped: it's v-html, so its elements
     can't carry utilities and must be reached via :deep. -->
<style scoped>
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
