<script setup lang="ts">
import type { Filter } from "../composables/useSessions";
import FilterChip from "./FilterChip.vue";

// The All / Unread chips + recency re-sort button, shared by the vertical
// Sidebar and the horizontal SessionTabBar. `alignRefreshEnd` pushes the sort
// button to the far end of the row (the vertical sidebar's full-width layout).
defineProps<{
  filter: Filter;
  unreadCount: number;
  alignRefreshEnd?: boolean;
}>();
const emit = defineEmits<{
  (e: "update:filter", f: Filter): void;
  (e: "refresh"): void;
}>();
</script>

<template>
  <FilterChip label="All" :active="filter === 'all'" @click="emit('update:filter', 'all')" />
  <FilterChip label="Unread" :count="unreadCount" :active="filter === 'unread'" @click="emit('update:filter', 'unread')" />
  <button
    class="cursor-pointer border-0 bg-transparent text-[14px] leading-none text-muted hover:text-fg"
    :class="{ 'ml-auto': alignRefreshEnd }"
    title="Sort by most recent"
    aria-label="Sort by most recent"
    @click="emit('refresh')"
  >
    <span class="material-symbols-outlined">refresh</span>
  </button>
</template>
