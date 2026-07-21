<script setup lang="ts">
import { computed } from "vue";
import { isUnread, type Session, type Filter } from "../composables/useSessions";
import { useSessionFilter, type SessionListEmits } from "../composables/sessionList";
import SessionFilters from "./SessionFilters.vue";

// Presentational: list + filter are owned by App.vue and shared with the
// vertical Sidebar, so switching layouts preserves them (no refetch/reset).
const props = defineProps<{
  sessions: Session[];
  activeId: string | null;
  filter: Filter;
}>();
const emit = defineEmits<SessionListEmits>();

const { unreadCount, filteredSessions } = useSessionFilter(props);

// The horizontal bar never scrolls — tabs flex to share the available width.
// Cap to the most-recent N (sessions are already sorted by recency) so they
// don't shrink to unreadable slivers when there are many. The unread filter
// applies before the cap.
const MAX_TABS = 8;
const visibleSessions = computed(() => filteredSessions.value.slice(0, MAX_TABS));
</script>

<template>
  <div class="tabbar">
    <button class="new-btn" title="New session" aria-label="New session" @click="emit('new')">
      <span class="material-symbols-outlined">add</span>
    </button>
    <button class="new-btn new-codex-btn" title="New Codex session" aria-label="New Codex session" @click="emit('new-codex')">cx</button>

    <div class="filters">
      <SessionFilters :filter="filter" :unread-count="unreadCount" @update:filter="emit('update:filter', $event)" @refresh="emit('refresh')" />
    </div>

    <div class="tabs">
      <button
        v-for="s in visibleSessions"
        :key="s.id"
        :class="['tab', { active: s.id === props.activeId, waiting: isUnread(s) }]"
        :title="s.title"
        :aria-current="s.id === props.activeId ? 'page' : undefined"
        @click="emit('select', s.id, s.agent ?? 'claude')"
      >
        <span v-if="s.working && !s.waiting && s.id !== props.activeId" class="spinner" title="Claude is working" aria-label="Claude is working" />
        <span v-if="s.agent === 'codex'" class="agent-badge">cx</span>
        <span class="tab-title">{{ s.title }}</span>
        <span v-if="isUnread(s) && s.id !== props.activeId" class="unread-dot" aria-label="Unread" />
      </button>
    </div>

    <div class="actions">
      <button
        class="bg-transparent border-0 text-muted text-base leading-none cursor-pointer hover:text-fg"
        title="Switch to vertical sidebar"
        aria-label="Switch to vertical sidebar"
        @click="emit('toggle-layout')"
      >
        <span class="material-symbols-outlined">dock_to_right</span>
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
  background: var(--bg-panel);
  color: var(--text);
  font-family: system-ui, sans-serif;
  border-bottom: 1px solid var(--border);
  overflow: hidden;
}

.new-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  background: var(--bg-selected);
  color: var(--text-secondary);
  border: none;
  border-radius: 6px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.new-btn:hover {
  background: var(--bg-selected-hover);
}
.new-codex-btn {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}
.agent-badge {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-selected);
  color: var(--text-dim);
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
}

.filters {
  display: flex;
  align-items: center;
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
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s;
}
.tab:hover {
  background: var(--bg-subtle);
}
.tab.active {
  background: var(--bg-subtle);
  border-color: var(--accent);
}

.tab-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Background session waiting for input (unread): bold, like the sidebar. */
.tab.waiting .tab-title {
  font-weight: 700;
  color: var(--text);
}

.unread-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--err-strong);
  box-shadow: 0 0 0 2px var(--bg-panel);
}

/* Spinning "thinking" ring — mirrors the vertical sidebar's spinner. */
.spinner {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-top-color: var(--accent);
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
</style>
