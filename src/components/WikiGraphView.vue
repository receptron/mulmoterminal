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
  <div class="max-w-[820px] mx-auto pt-6 px-7 pb-16">
    <p v-if="!graph.nodes.length" class="py-12 px-7 text-center text-muted">No pages yet.</p>
    <ul v-else class="list-none flex flex-col gap-3.5">
      <li v-for="node in rows" :key="node.slug" class="py-3 px-3.5 bg-panel border border-border rounded-lg">
        <div class="flex items-baseline gap-2.5">
          <button
            type="button"
            class="bg-transparent border-0 text-[15px] font-semibold text-fg cursor-pointer hover:text-accent"
            @click="wikiGotoPage(node.slug)"
          >
            {{ node.title }}
          </button>
          <span v-if="incomingCount.get(node.slug)" class="text-[12px] text-muted" :title="`${incomingCount.get(node.slug)} incoming link(s)`">
            ← {{ incomingCount.get(node.slug) }}
          </span>
        </div>
        <div v-if="outgoing.get(node.slug)?.length" class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="to in outgoing.get(node.slug)"
            :key="to"
            type="button"
            class="text-[12px] py-0.5 px-2 bg-subtle border border-border rounded-full text-secondary cursor-pointer hover:text-fg hover:border-accent"
            @click="wikiGotoPage(to)"
          >
            {{ title(to) }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
