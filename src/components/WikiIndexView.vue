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

// Full per-tag page counts.
const tagCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const e of props.entries) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
});

// Filter-bar chips, mirroring MulmoClaude's wiki View: drop singletons (a tag on one
// page adds no filtering value, just visual noise — it stays clickable from the card),
// sort by count desc then name asc, and raise the cutoff adaptively so the row stays
// around TARGET_FILTER_CHIPS even on big wikis. The cutoff is the count at the target
// position, so equally-popular tags are kept together rather than sliced arbitrarily.
const TARGET_FILTER_CHIPS = 20;
const meaningfulTags = computed(() => [...tagCounts.value.entries()].filter(([, c]) => c > 1).sort(([ta, ca], [tb, cb]) => cb - ca || ta.localeCompare(tb)));
const cutoffTags = computed<[string, number][]>(() => {
  const m = meaningfulTags.value;
  if (m.length <= TARGET_FILTER_CHIPS) return m;
  const cutoff = m[TARGET_FILTER_CHIPS - 1][1];
  return m.filter(([, c]) => c >= cutoff);
});
// Keep any selected tag the cutoff hides (e.g. a singleton picked from a card) visible
// in the bar so it stays removable.
const visibleTags = computed<[string, number][]>(() => {
  const shown = new Set(cutoffTags.value.map(([t]) => t));
  const extra = [...selected.value]
    .filter((t) => !shown.has(t))
    .sort((a, b) => a.localeCompare(b))
    .map((t): [string, number] => [t, tagCounts.value.get(t) ?? 1]);
  return [...cutoffTags.value, ...extra];
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
    <div v-if="visibleTags.length" class="tag-filter">
      <FilterChip v-for="[tag, count] in visibleTags" :key="tag" :label="`#${tag}`" :count="count" :active="selected.has(tag)" @click="toggleTag(tag)" />
    </div>
    <p v-if="!entries.length" class="wiki-empty">The wiki is empty.</p>
    <ul v-else class="card-grid">
      <li v-for="entry in filtered" :key="entry.slug">
        <!-- A div (not button) so the per-tag filter chips can be real buttons. -->
        <div
          class="page-card"
          role="button"
          tabindex="0"
          @click="wikiGotoPage(entry.slug)"
          @keydown.enter="wikiGotoPage(entry.slug)"
          @keydown.space.prevent="wikiGotoPage(entry.slug)"
        >
          <span class="card-title">{{ entry.title }}</span>
          <span v-if="entry.description" class="card-desc">{{ entry.description }}</span>
          <span v-if="entry.tags.length" class="card-tags">
            <button v-for="t in entry.tags" :key="t" type="button" class="card-tag" :class="{ active: selected.has(t) }" @click.stop="toggleTag(t)">
              #{{ t }}
            </button>
          </span>
        </div>
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
  padding: 0;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}
.card-tag:hover {
  color: var(--accent);
}
.card-tag.active {
  color: var(--accent);
  font-weight: 600;
}
.wiki-empty {
  padding: 48px 28px;
  text-align: center;
  color: var(--text-muted);
}
</style>
