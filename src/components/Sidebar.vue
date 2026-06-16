<script setup lang="ts">
import { computed } from "vue";
import type { Session, Filter } from "../composables/useSessions";
import FilterChip from "./FilterChip.vue";

// Presentational: the session list + filter are owned by App.vue (a single
// useSessions instance shared across layouts) so toggling vertical/horizontal
// doesn't reset or refetch them.
const props = defineProps<{
  sessions: Session[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  filter: Filter;
}>();
const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "new"): void;
  (e: "toggle-layout"): void;
  (e: "refresh"): void;
  (e: "update:filter", f: Filter): void;
}>();

// A background session that is `waiting` for the user's attention is what
// mulmoclaude calls "unread" — render it bold and let the user filter to just
// those rows.
const unreadCount = computed(() => props.sessions.filter((s) => s.waiting).length);
const visibleSessions = computed(() =>
  props.filter === "unread" ? props.sessions.filter((s) => s.waiting) : props.sessions
);

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="heading">Sessions</span>
      <button
        class="icon-btn"
        title="Switch to horizontal tabs"
        aria-label="Switch to horizontal tabs"
        @click="emit('toggle-layout')"
      >
        ⇥
      </button>
    </div>

    <button class="new-btn" @click="emit('new')">
      + New session
    </button>

    <div class="filters">
      <FilterChip
        label="All"
        :active="filter === 'all'"
        @click="emit('update:filter', 'all')"
      />
      <FilterChip
        label="Unread"
        :count="unreadCount"
        :active="filter === 'unread'"
        @click="emit('update:filter', 'unread')"
      />
      <button
        class="icon-btn sort-btn"
        title="Sort by most recent"
        aria-label="Sort by most recent"
        @click="emit('refresh')"
      >
        ⟳
      </button>
    </div>

    <div v-if="loading" class="state">
      Loading…
    </div>
    <div v-else-if="error" class="state error">
      {{ error }}
    </div>
    <div v-else-if="sessions.length === 0" class="state">
      No sessions yet
    </div>
    <div v-else-if="visibleSessions.length === 0" class="state">
      No unread sessions
    </div>

    <ul v-else class="list">
      <li
        v-for="s in visibleSessions"
        :key="s.id"
        :class="['item', { active: s.id === props.activeId, waiting: s.waiting }]"
        :title="s.title"
        @click="emit('select', s.id)"
      >
        <span class="item-title">
          <span
            v-if="s.working && !s.waiting && s.id !== props.activeId"
            class="spinner"
            title="Claude is working"
            aria-label="Claude is working"
          />
          {{ s.title }}
        </span>
        <span class="item-time">{{ relativeTime(s.mtime) }}</span>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #16213e;
  color: #e0e0e0;
  font-family: system-ui, sans-serif;
  border-right: 1px solid #2a2a4e;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
}

.heading {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #9aa5c4;
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

.new-btn {
  margin: 0 12px 8px;
  padding: 8px;
  background: #1b3a6b;
  color: #cfe0ff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.new-btn:hover {
  background: #224a86;
}

.filters {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 8px;
}

/* Recency re-sort sits with the list controls, pushed to the far right. */
.sort-btn {
  margin-left: auto;
  font-size: 14px;
}

.state {
  padding: 12px 14px;
  font-size: 13px;
  color: #9aa5c4;
}
.state.error {
  color: #ef9a9a;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}

.item {
  padding: 10px 14px;
  cursor: pointer;
  border-left: 3px solid transparent;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.item:hover {
  background: #1d2b4e;
}
.item.active {
  background: #1d2b4e;
  border-left-color: #4a8cff;
}

.item-title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Background session waiting for input (Notification); cleared on foreground. */
.item.waiting .item-title {
  font-weight: 700;
  color: #ffffff;
}

/* Shown while Claude is working/"thinking" in a session (UserPromptSubmit →
   Stop). Mirrors mulmoclaude's spinning role icon: a slowly rotating ring. */
.spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 5px;
  border: 2px solid rgba(74, 140, 255, 0.3);
  border-top-color: #4a8cff;
  border-radius: 50%;
  vertical-align: middle;
  animation: sidebar-spin 0.9s linear infinite;
}

@keyframes sidebar-spin {
  to {
    transform: rotate(360deg);
  }
}

.item-time {
  font-size: 11px;
  color: #7c87a8;
}
</style>
