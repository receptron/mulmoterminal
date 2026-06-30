<script setup lang="ts">
// The wiki page catalog: a tag filter + one card per page, parsed from index.md by the
// shared core engine (entries come straight from GET /api/wiki). Clicking a card opens
// the page; clicking a tag chip filters the list (AND across selected tags). Read-only.
import { computed, ref } from "vue";
import type { WikiPageEntry } from "@mulmoclaude/core/wiki";
import FilterChip from "./FilterChip.vue";
import { wikiGotoPage } from "../composables/useWikiBrowse";

const props = defineProps<{ entries: WikiPageEntry[] }>();

const selected = ref<Set<string>>(new Set());

// All tags with their page counts, most-used first (stable for display).
const allTags = computed(() => {
  const counts = new Map<string, number>();
  for (const e of props.entries) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
});

const filtered = computed(() => {
  if (selected.value.size === 0) return props.entries;
  return props.entries.filter((e) => {
    const tags = new Set(e.tags);
    return [...selected.value].every((t) => tags.has(t));
  });
});

function toggleTag(tag: string): void {
  const next = new Set(selected.value);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  selected.value = next;
}
</script>

<template>
  <div class="wiki-index">
    <div v-if="allTags.length" class="tag-filter">
      <FilterChip v-for="{ tag, count } in allTags" :key="tag" :label="`#${tag}`" :count="count" :active="selected.has(tag)" @click="toggleTag(tag)" />
    </div>
    <p v-if="!entries.length" class="wiki-empty">The wiki is empty.</p>
    <ul v-else class="card-grid">
      <li v-for="entry in filtered" :key="entry.slug">
        <button type="button" class="page-card" @click="wikiGotoPage(entry.slug)">
          <span class="card-title">{{ entry.title }}</span>
          <span v-if="entry.description" class="card-desc">{{ entry.description }}</span>
          <span v-if="entry.tags.length" class="card-tags">
            <span v-for="t in entry.tags" :key="t" class="card-tag">#{{ t }}</span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.wiki-index {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px 28px 64px;
}
.tag-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 20px;
}
.card-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.page-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  height: 100%;
  text-align: left;
  padding: 14px 16px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
}
.page-card:hover {
  border-color: var(--accent);
}
.card-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--text);
}
.card-desc {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
.card-tag {
  font-size: 11px;
  color: var(--text-muted);
}
.wiki-empty {
  padding: 48px 28px;
  text-align: center;
  color: var(--text-muted);
}
</style>
