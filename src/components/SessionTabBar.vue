<script setup lang="ts">
import { ref, computed } from "vue";
import { useSessions } from "../composables/useSessions";
import FilterChip from "./FilterChip.vue";

const props = defineProps<{ activeId: string | null }>();
const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "new"): void;
  (e: "toggle-layout"): void;
}>();

const { sessions, refresh } = useSessions();

// Same "unread" = `waiting` mapping as the vertical sidebar; the filter applies
// to the horizontal tabs too.
type Filter = "all" | "unread";
const filter = ref<Filter>("all");
const unreadCount = computed(() => sessions.value.filter((s) => s.waiting).length);

// The horizontal bar never scrolls — tabs flex to share the available width.
// Cap to the most-recent N (sessions are already sorted by recency) so they
// don't shrink to unreadable slivers when there are many. The unread filter
// applies before the cap.
const MAX_TABS = 8;
const visibleSessions = computed(() => {
  const list = filter.value === "unread" ? sessions.value.filter((s) => s.waiting) : sessions.value;
  return list.slice(0, MAX_TABS);
});
</script>

<template>
  <div class="tabbar">
    <button class="new-btn" title="New session" @click="emit('new')">
      +
    </button>

    <div class="filters">
      <FilterChip
        label="All"
        :active="filter === 'all'"
        @click="filter = 'all'"
      />
      <FilterChip
        label="Unread"
        :count="unreadCount"
        :active="filter === 'unread'"
        @click="filter = 'unread'"
      />
    </div>

    <div class="tabs">
      <button
        v-for="s in visibleSessions"
        :key="s.id"
        :class="['tab', { active: s.id === props.activeId, waiting: s.waiting }]"
        :title="s.title"
        :aria-current="s.id === props.activeId ? 'page' : undefined"
        @click="emit('select', s.id)"
      >
        <span
          v-if="s.working && !s.waiting && s.id !== props.activeId"
          class="spinner"
          title="Claude is working"
          aria-label="Claude is working"
        />
        <span class="tab-title">{{ s.title }}</span>
        <span
          v-if="s.waiting && s.id !== props.activeId"
          class="unread-dot"
          aria-label="Unread"
        />
      </button>
    </div>

    <div class="actions">
      <button class="icon-btn" title="Refresh" @click="refresh">
        ⟳
      </button>
      <button
        class="icon-btn"
        title="Switch to vertical sidebar"
        @click="emit('toggle-layout')"
      >
        ⇤
      </button>
    </div>
  </div>
</template>

<style scoped>
.tabbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  flex-shrink: 0;
  padding: 0 10px;
  background: #16213e;
  color: #e0e0e0;
  font-family: system-ui, sans-serif;
  border-bottom: 1px solid #2a2a4e;
  overflow: hidden;
}

.new-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  background: #1b3a6b;
  color: #cfe0ff;
  border: none;
  border-radius: 6px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.new-btn:hover {
  background: #224a86;
}

.filters {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.tabs {
  display: flex;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1 1 0;
  min-width: 0;
  max-width: 200px;
  height: 28px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #cdd5ee;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s;
}
.tab:hover {
  background: #1d2b4e;
}
.tab.active {
  background: #1d2b4e;
  border-color: #4a8cff;
}

.tab-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Background session waiting for input (unread): bold, like the sidebar. */
.tab.waiting .tab-title {
  font-weight: 700;
  color: #ffffff;
}

.unread-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 0 2px #16213e;
}

/* Spinning "thinking" ring — mirrors the vertical sidebar's spinner. */
.spinner {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(74, 140, 255, 0.3);
  border-top-color: #4a8cff;
  border-radius: 50%;
  animation: tabbar-spin 0.9s linear infinite;
}

@keyframes tabbar-spin {
  to {
    transform: rotate(360deg);
  }
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.icon-btn {
  background: none;
  border: none;
  color: #9aa5c4;
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
}
.icon-btn:hover {
  color: #e0e0e0;
}
</style>
