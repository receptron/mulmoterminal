<script setup lang="ts">
import { isUnread } from "../composables/useSessions";
import { useSessionFilter, type SessionListEmits, type SessionListProps } from "../composables/sessionList";
import SessionFilters from "./SessionFilters.vue";

// Presentational: the session list + filter are owned by App.vue (a single
// useSessions instance shared across layouts) so toggling vertical/horizontal
// doesn't reset or refetch them.
const props = defineProps<
  SessionListProps & {
    // Only the vertical layout has room to report these; the tab bar just shows what it has.
    loading: boolean;
    error: string | null;
  }
>();
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
  <aside class="flex w-[260px] shrink-0 flex-col overflow-hidden border-r border-border bg-panel font-sans text-fg">
    <div class="flex h-10 flex-none items-center justify-between border-b border-border px-3.5">
      <span class="text-[13px] font-semibold tracking-[0.05em] text-muted">Sessions</span>
      <button
        class="bg-transparent border-0 text-muted text-base leading-none cursor-pointer hover:text-fg"
        title="Switch to horizontal tabs"
        aria-label="Switch to horizontal tabs"
        @click="emit('toggle-layout')"
      >
        <span class="material-symbols-outlined">toolbar</span>
      </button>
    </div>

    <div class="mx-3 mb-2 flex gap-2">
      <button
        class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-selected p-2 text-[13px] text-secondary hover:bg-selected-hover"
        @click="emit('new')"
      >
        <span class="material-symbols-outlined text-[18px]">add</span> New session
      </button>
      <button
        class="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-selected p-2 text-[13px] text-secondary hover:bg-selected-hover"
        title="New Codex session"
        @click="emit('new-codex')"
      >
        <span class="material-symbols-outlined text-[18px]">add</span> Codex
      </button>
    </div>

    <div class="flex items-center gap-1.5 px-3 pb-2">
      <SessionFilters
        :filter="filter"
        :unread-count="unreadCount"
        align-refresh-end
        @update:filter="emit('update:filter', $event)"
        @refresh="emit('refresh')"
      />
    </div>

    <div v-if="loading" class="px-3.5 py-3 text-[13px] text-muted">Loading…</div>
    <div v-else-if="error" class="px-3.5 py-3 text-[13px] text-err">
      {{ error }}
    </div>
    <div v-else-if="sessions.length === 0" class="px-3.5 py-3 text-[13px] text-muted">No sessions yet</div>
    <div v-else-if="filteredSessions.length === 0" class="px-3.5 py-3 text-[13px] text-muted">No unread sessions</div>

    <ul v-else class="m-0 flex-1 list-none overflow-y-auto p-0">
      <li
        v-for="s in filteredSessions"
        :key="s.id"
        data-testid="session-item"
        class="flex cursor-pointer flex-col gap-0.5 border-l-[3px] px-3.5 py-2.5"
        :class="[{ waiting: isUnread(s) }, s.id === props.activeId ? 'border-l-accent bg-subtle' : 'border-l-transparent hover:bg-subtle']"
        :title="s.title"
        @click="emit('select', s.id, s.agent ?? 'claude')"
      >
        <span class="truncate text-[13px]" :class="{ 'font-bold text-fg': isUnread(s) }">
          <span
            v-if="s.working && !s.waiting && s.id !== props.activeId"
            data-testid="session-spinner"
            class="spinner"
            title="Claude is working"
            aria-label="Claude is working"
          />
          <span
            v-if="s.agent === 'codex'"
            data-testid="agent-badge"
            class="mr-[5px] inline-block rounded-[4px] bg-selected px-[5px] align-middle text-[10px] font-semibold uppercase text-dim"
            >codex</span
          >
          {{ s.title }}
        </span>
        <span class="text-[11px] text-dim">{{ relativeTime(s.mtime) }}</span>
      </li>
    </ul>
  </aside>
</template>

<!-- The spinner's animated ring (custom keyframes + a color-mix border) has no
     utility equivalent, so it stays scoped; everything else is utilities. -->
<style scoped>
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
</style>
