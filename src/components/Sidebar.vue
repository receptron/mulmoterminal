<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { usePubSub } from "../composables/usePubSub";

interface Session {
  id: string;
  title: string;
  mtime: number;
  working: boolean;
  waiting: boolean;
}

const props = defineProps<{ activeId: string | null }>();
const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "new"): void;
}>();

const sessions = ref<Session[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function load() {
  try {
    const res = await fetch("/api/sessions");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    sessions.value = data.sessions ?? [];
    error.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    // Only the first load shows the "Loading…" state; later refreshes are
    // silent so the list doesn't flicker.
    loading.value = false;
  }
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

defineExpose({ load });

// The server publishes on the "sessions" channel whenever anything about the
// session list changes (created, working/idle, closed). We just refetch the
// server's authoritative list — no client-side bookkeeping about what changed.
const { subscribe } = usePubSub();
let unsubscribe: (() => void) | undefined;

onMounted(() => {
  load();
  unsubscribe = subscribe("sessions", () => load());
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="heading">Sessions</span>
      <button class="icon-btn" title="Refresh" @click="load">⟳</button>
    </div>

    <button class="new-btn" @click="emit('new')">+ New session</button>

    <div v-if="loading" class="state">Loading…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <div v-else-if="sessions.length === 0" class="state">No sessions yet</div>

    <ul v-else class="list">
      <li
        v-for="s in sessions"
        :key="s.id"
        :class="['item', { active: s.id === props.activeId, waiting: s.waiting }]"
        :title="s.title"
        @click="emit('select', s.id)"
      >
        <span class="item-title">
          <span v-if="s.working" class="dot" title="Claude is working" />
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

/* Shown while Claude is working in a session (UserPromptSubmit → Stop). */
.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 4px;
  border-radius: 50%;
  background: #4a8cff;
  vertical-align: middle;
}

.item-time {
  font-size: 11px;
  color: #7c87a8;
}
</style>
