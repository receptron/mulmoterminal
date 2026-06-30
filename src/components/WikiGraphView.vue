<script setup lang="ts">
// A small, read-only view of the wiki link graph: one row per page with its outgoing
// links as clickable chips and an incoming-link count. Deliberately a textual list
// (not a force-directed canvas) — "a small graph view" per plans/feat-wiki.md, and it
// stays useful at any size without a layout engine.
import { computed } from "vue";
import type { WikiGraph } from "@mulmoclaude/core/wiki";
import { wikiGotoPage } from "../composables/useWikiBrowse";

const props = defineProps<{ graph: WikiGraph }>();

const titleBySlug = computed(() => new Map(props.graph.nodes.map((n) => [n.slug, n.title])));
const incomingCount = computed(() => {
  const counts = new Map<string, number>();
  for (const e of props.graph.edges) counts.set(e.to, (counts.get(e.to) ?? 0) + 1);
  return counts;
});
const outgoing = computed(() => {
  const map = new Map<string, string[]>();
  for (const e of props.graph.edges) {
    const list = map.get(e.from) ?? [];
    list.push(e.to);
    map.set(e.from, list);
  }
  return map;
});

// Most-referenced pages first, so the graph reads as "what's central".
const rows = computed(() => [...props.graph.nodes].sort((a, b) => (incomingCount.value.get(b.slug) ?? 0) - (incomingCount.value.get(a.slug) ?? 0)));

function title(slug: string): string {
  return titleBySlug.value.get(slug) ?? slug;
}
</script>

<template>
  <div class="wiki-graph">
    <p v-if="!graph.nodes.length" class="wiki-empty">No pages yet.</p>
    <ul v-else class="graph-list">
      <li v-for="node in rows" :key="node.slug" class="graph-row">
        <div class="graph-head">
          <button type="button" class="graph-node" @click="wikiGotoPage(node.slug)">{{ node.title }}</button>
          <span v-if="incomingCount.get(node.slug)" class="graph-incoming" :title="`${incomingCount.get(node.slug)} incoming link(s)`">
            ← {{ incomingCount.get(node.slug) }}
          </span>
        </div>
        <div v-if="outgoing.get(node.slug)?.length" class="graph-edges">
          <button v-for="to in outgoing.get(node.slug)" :key="to" type="button" class="graph-chip" @click="wikiGotoPage(to)">
            {{ title(to) }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.wiki-graph {
  max-width: 820px;
  margin: 0 auto;
  padding: 24px 28px 64px;
}
.graph-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.graph-row {
  padding: 12px 14px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.graph-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.graph-node {
  background: none;
  border: none;
  padding: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}
.graph-node:hover {
  color: var(--accent);
}
.graph-incoming {
  font-size: 12px;
  color: var(--text-muted);
}
.graph-edges {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.graph-chip {
  font-size: 12px;
  padding: 2px 8px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-secondary);
  cursor: pointer;
}
.graph-chip:hover {
  color: var(--text);
  border-color: var(--accent);
}
.wiki-empty {
  padding: 48px 28px;
  text-align: center;
  color: var(--text-muted);
}
</style>
