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
  <div class="flex h-10 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-panel px-2.5 font-sans text-fg">
    <button
      class="h-[26px] w-[26px] shrink-0 cursor-pointer rounded-md border-0 bg-selected text-[16px] leading-none text-secondary hover:bg-selected-hover"
      title="New session"
      aria-label="New session"
      @click="emit('new')"
    >
      <span class="material-symbols-outlined">add</span>
    </button>
    <button
      class="h-[26px] w-[26px] shrink-0 cursor-pointer rounded-md border-0 bg-selected text-[12px] font-semibold uppercase leading-none text-secondary hover:bg-selected-hover"
      title="New Codex session"
      aria-label="New Codex session"
      @click="emit('new-codex')"
    >
      cx
    </button>

    <div class="flex shrink-0 items-center gap-1.5">
      <SessionFilters :filter="filter" :unread-count="unreadCount" @update:filter="emit('update:filter', $event)" @refresh="emit('refresh')" />
    </div>

    <div class="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
      <button
        v-for="s in visibleSessions"
        :key="s.id"
        class="relative flex h-7 min-w-0 max-w-[200px] flex-1 cursor-pointer items-center gap-[5px] rounded-md border px-2.5 text-[12px] text-secondary transition-[background] duration-[120ms] ease-[ease]"
        :class="s.id === props.activeId ? 'border-accent bg-subtle' : 'border-transparent hover:bg-subtle'"
        :title="s.title"
        :aria-current="s.id === props.activeId ? 'page' : undefined"
        @click="emit('select', s.id, s.agent ?? 'claude')"
      >
        <span v-if="s.working && !s.waiting && s.id !== props.activeId" class="spinner" title="Claude is working" aria-label="Claude is working" />
        <span v-if="s.agent === 'codex'" class="shrink-0 rounded-[3px] bg-selected px-1 text-[9px] font-bold uppercase text-dim">cx</span>
        <span class="truncate" :class="{ 'font-bold text-fg': isUnread(s) }">{{ s.title }}</span>
        <span
          v-if="isUnread(s) && s.id !== props.activeId"
          class="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--err-strong)] shadow-[0_0_0_2px_var(--bg-panel)]"
          aria-label="Unread"
        />
      </button>
    </div>

    <div class="flex shrink-0 items-center gap-2">
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

<!-- The spinner's animated ring (custom keyframes + a color-mix border) has no
     utility equivalent, so it stays scoped; everything else is utilities. -->
<style scoped>
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
</style>
