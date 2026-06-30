<script setup lang="ts">
// Read-only render of one wiki page: sanitized markdown body with clickable
// `[[wiki links]]`, rewritten image refs, and a "Linked references" (backlinks)
// section derived from the shared graph. Navigation is delegated up via the
// useWikiBrowse helpers — clicking a link/backlink pushes /wiki/pages/<slug>.
import { computed } from "vue";
import { resolveLinkTarget, wikiSlugify, isSafeWikiSlug, incomingLinks, type WikiGraph } from "@mulmoclaude/core/wiki";
import { renderWikiHtml } from "../wikiMarkdown";
import { wikiGotoPage } from "../composables/useWikiBrowse";
import type { WikiPage } from "../wikiApi";

const props = defineProps<{ slug: string; page: WikiPage; graph: WikiGraph | null }>();

const html = computed(() => (props.page.exists ? renderWikiHtml(props.page.content) : ""));

// Title→slug map (lowercased keys) lets resolveLinkTarget map non-ASCII `[[titles]]`
// back to their ASCII file slug, exactly as the server engine does.
const fileSlugs = computed(() => new Set((props.graph?.nodes ?? []).map((n) => n.slug)));
const slugByTitle = computed(() => new Map((props.graph?.nodes ?? []).map((n) => [n.title.toLowerCase(), n.slug])));
const backlinks = computed(() => (props.graph ? incomingLinks(props.graph, props.slug) : []));

// Event-delegated `[[link]]` clicks: resolve the raw target to a file slug (graph
// first, then a plain slugify fallback) and navigate.
function onBodyClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".wiki-link");
  const target = el?.getAttribute("data-page");
  if (!target) return;
  e.preventDefault();
  let slug = props.graph ? resolveLinkTarget(target, fileSlugs.value, slugByTitle.value) : null;
  if (!slug) {
    const fallback = wikiSlugify(target);
    slug = isSafeWikiSlug(fallback) ? fallback : null;
  }
  if (slug) wikiGotoPage(slug);
}
</script>

<template>
  <article class="wiki-page">
    <template v-if="page.exists">
      <h1 class="wiki-page-title">{{ page.resolvedTitle }}</h1>
      <!-- eslint-disable-next-line vue/no-v-html -- LLM-authored, sanitized in renderWikiHtml -->
      <div class="wiki-body" @click="onBodyClick" v-html="html"></div>
      <section v-if="backlinks.length" class="wiki-backlinks">
        <h2>Linked references</h2>
        <ul>
          <li v-for="node in backlinks" :key="node.slug">
            <button type="button" class="wiki-ref" @click="wikiGotoPage(node.slug)">{{ node.title }}</button>
          </li>
        </ul>
      </section>
    </template>
    <p v-else class="wiki-empty">Page “{{ slug }}” not found.</p>
  </article>
</template>

<style scoped>
.wiki-page {
  max-width: 820px;
  margin: 0 auto;
  padding: 24px 28px 64px;
  color: var(--text);
}
.wiki-page-title {
  margin: 0 0 16px;
  font-size: 24px;
  font-weight: 700;
}
/* Markdown body — readable defaults over the app theme. :deep reaches the v-html. */
.wiki-body {
  font-size: 14px;
  line-height: 1.65;
}
.wiki-body :deep(h1),
.wiki-body :deep(h2),
.wiki-body :deep(h3) {
  margin: 1.4em 0 0.5em;
  font-weight: 650;
}
.wiki-body :deep(a) {
  color: var(--accent);
}
.wiki-body :deep(code) {
  background: var(--bg-subtle);
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-size: 0.9em;
}
.wiki-body :deep(pre) {
  background: var(--bg-subtle);
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
}
.wiki-body :deep(img) {
  max-width: 100%;
  height: auto;
}
.wiki-body :deep(blockquote) {
  margin: 1em 0;
  padding-left: 12px;
  border-left: 3px solid var(--border);
  color: var(--text-secondary);
}
/* Clickable [[wiki links]] (spans from core's renderWikiLinks). */
.wiki-body :deep(.wiki-link) {
  color: var(--accent);
  cursor: pointer;
  border-bottom: 1px dotted var(--accent);
}
.wiki-backlinks {
  margin-top: 40px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.wiki-backlinks h2 {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin: 0 0 8px;
}
.wiki-backlinks ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.wiki-ref {
  background: none;
  border: none;
  padding: 2px 0;
  color: var(--accent);
  cursor: pointer;
  font-size: 14px;
}
.wiki-ref:hover {
  text-decoration: underline;
}
.wiki-empty {
  padding: 48px 28px;
  text-align: center;
  color: var(--text-muted);
}
</style>
