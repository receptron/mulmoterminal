<script setup lang="ts">
// The wiki page catalog: a tag filter + one card per page, parsed from index.md by the
// shared core engine (entries come straight from GET /api/wiki). Clicking a card opens
// the page; clicking a tag chip filters the list (AND across selected tags). Read-only.
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { WikiPageEntry } from "@mulmoclaude/core/wiki";
import FilterChip from "./FilterChip.vue";
import { wikiGotoPage } from "../composables/useWikiBrowse";
import { filterChips, filterEntriesByTags, parseTagQuery } from "./wikiTagFilter";

const props = defineProps<{ entries: WikiPageEntry[] }>();

const route = useRoute();
// Pre-select tags named by `?tag=` (the Worklog header shortcut opens `/wiki?tag=worklog`).
// Watched so arriving at an already-open index via a new tag re-applies the filter; manual
// chip toggles below then take over local state without touching the URL.
const selected = ref<Set<string>>(parseTagQuery(route.query.tag));
watch(
  () => route.query.tag,
  (tag) => {
    selected.value = parseTagQuery(tag);
  },
);

const visibleTags = computed(() => filterChips(props.entries, selected.value));
const filtered = computed(() => filterEntriesByTags(props.entries, selected.value));

function toggleTag(tag: string): void {
  const next = new Set(selected.value);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  selected.value = next;
}
</script>

<template>
  <div class="max-w-[900px] mx-auto pt-5 px-7 pb-16">
    <div v-if="visibleTags.length" class="flex flex-wrap gap-1.5 mb-5">
      <FilterChip v-for="[tag, count] in visibleTags" :key="tag" :label="`#${tag}`" :count="count" :active="selected.has(tag)" @click="toggleTag(tag)" />
    </div>
    <p v-if="!entries.length" class="py-12 px-7 text-center text-muted">The wiki is empty.</p>
    <ul v-else class="list-none m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      <li v-for="entry in filtered" :key="entry.slug">
        <!-- A div (not button) so the per-tag filter chips can be real buttons. -->
        <div
          class="flex flex-col gap-1.5 w-full h-full text-left py-3.5 px-4 bg-panel border border-border rounded-[10px] cursor-pointer hover:border-accent"
          role="button"
          tabindex="0"
          @click="wikiGotoPage(entry.slug)"
          @keydown.enter="wikiGotoPage(entry.slug)"
          @keydown.space.prevent="wikiGotoPage(entry.slug)"
        >
          <span class="text-[14px] font-[650] text-fg">{{ entry.title }}</span>
          <span v-if="entry.description" class="text-[12.5px] leading-normal text-secondary">{{ entry.description }}</span>
          <span v-if="entry.tags.length" class="flex flex-wrap gap-1.5 mt-0.5">
            <button
              v-for="t in entry.tags"
              :key="t"
              type="button"
              class="text-[11px] border-0 bg-transparent cursor-pointer"
              :class="selected.has(t) ? 'text-accent font-semibold' : 'text-muted hover:text-accent'"
              @click.stop="toggleTag(t)"
            >
              #{{ t }}
            </button>
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>
