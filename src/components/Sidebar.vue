<script setup lang="ts">
import { isUnread, type Session, type Filter } from "../composables/useSessions";
import { useSessionFilter, type SessionListEmits } from "../composables/sessionList";
import SessionFilters from "./SessionFilters.vue";

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
const emit = defineEmits<SessionListEmits>();

const { unreadCount, filteredSessions } = useSessionFilter(props);

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
        class="bg-transparent border-0 text-muted text-base leading-none cursor-pointer hover:text-fg"
        title="Switch to horizontal tabs"
        aria-label="Switch to horizontal tabs"
        @click="emit('toggle-layout')"
      >
        <span class="material-symbols-outlined">toolbar</span>
      </button>
    </div>

    <div class="new-row">
      <button class="new-btn" @click="emit('new')"><span class="material-symbols-outlined">add</span> New session</button>
      <button class="new-btn new-codex-btn" title="New Codex session" @click="emit('new-codex')">
        <span class="material-symbols-outlined">add</span> Codex
      </button>
    </div>

    <div class="filters">
      <SessionFilters
        :filter="filter"
        :unread-count="unreadCount"
        align-refresh-end
        @update:filter="emit('update:filter', $event)"
        @refresh="emit('refresh')"
      />
    </div>

    <div v-if="loading" class="state">Loading…</div>
    <div v-else-if="error" class="state error">
      {{ error }}
    </div>
    <div v-else-if="sessions.length === 0" class="state">No sessions yet</div>
    <div v-else-if="filteredSessions.length === 0" class="state">No unread sessions</div>

    <ul v-else class="list">
      <li
        v-for="s in filteredSessions"
        :key="s.id"
        :class="['item', { active: s.id === props.activeId, waiting: isUnread(s) }]"
        :title="s.title"
        @click="emit('select', s.id, s.agent ?? 'claude')"
      >
        <span class="item-title">
          <span v-if="s.working && !s.waiting && s.id !== props.activeId" class="spinner" title="Claude is working" aria-label="Claude is working" />
          <span v-if="s.agent === 'codex'" class="agent-badge">codex</span>
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
  background: var(--bg-panel);
  color: var(--text);
  font-family: system-ui, sans-serif;
  border-right: 1px solid var(--border);
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
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0 12px 8px;
  padding: 8px;
  background: var(--bg-selected);
  color: var(--text-secondary);
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.new-btn .material-symbols-outlined {
  font-size: 18px;
}
.new-btn:hover {
  background: var(--bg-selected-hover);
}
.new-row {
  display: flex;
  gap: 8px;
  margin: 0 12px 8px;
}
.new-row .new-btn {
  margin: 0;
}
.new-row .new-btn:first-child {
  flex: 1;
}

.filters {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 8px;
}

.state {
  padding: 12px 14px;
  font-size: 13px;
  color: var(--text-muted);
}
.state.error {
  color: var(--err);
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
  background: var(--bg-subtle);
}
.item.active {
  background: var(--bg-subtle);
  border-left-color: var(--accent);
}

.item-title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-badge {
  display: inline-block;
  margin-right: 5px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--bg-selected);
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  vertical-align: middle;
}

/* Background session waiting for input (Notification); cleared on foreground. */
.item.waiting .item-title {
  font-weight: 700;
  color: var(--text);
}

/* Shown while Claude is working/"thinking" in a session (UserPromptSubmit →
   Stop). Mirrors mulmoclaude's spinning role icon: a slowly rotating ring. */
.spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 5px;
  border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-top-color: var(--accent);
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
  color: var(--text-dim);
}
</style>
