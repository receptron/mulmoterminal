<script setup lang="ts">
// A read-only activity timeline for one session: the tools the agent ran (newest
// first), fetched from GET /api/transcript/timeline. Opened from the cell header's
// 🕘 button so you can see "what did it do?" without scrolling the raw transcript.
import { ref, watch, onUnmounted } from "vue";

interface TimelineEvent {
  ts: string;
  tool: string;
  summary: string;
}

const props = defineProps<{ sessionId: string | null; cwd: string | null; open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const events = ref<TimelineEvent[]>([]);
const truncated = ref(false);
const loading = ref(false);
const error = ref(false);

const isTimeline = (v: unknown): v is { events: TimelineEvent[]; truncated: boolean } =>
  typeof v === "object" && v !== null && Array.isArray((v as { events?: unknown }).events);

async function load(): Promise<void> {
  if (!props.sessionId) return;
  loading.value = true;
  error.value = false;
  try {
    const params = new URLSearchParams({ session: props.sessionId });
    if (props.cwd) params.set("cwd", props.cwd);
    const res = await fetch(`/api/transcript/timeline?${params.toString()}`);
    if (!res.ok) throw new Error(String(res.status));
    const data: unknown = await res.json();
    events.value = isTimeline(data) ? data.events : [];
    truncated.value = isTimeline(data) && data.truncated;
  } catch {
    error.value = true;
    events.value = [];
  } finally {
    loading.value = false;
  }
}

// Newest first for scanning recent activity.
const reversed = () => [...events.value].reverse();

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString();
};

// Document-level Escape so dismissal works regardless of focus (the backdrop isn't
// focused). Attached only while open; always removed on unmount.
const onKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") emit("close");
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      load();
      document.addEventListener("keydown", onKeydown);
    } else {
      document.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true },
);

onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="open" class="tl-backdrop" @click.self="emit('close')">
    <div class="tl-modal" role="dialog" aria-label="Activity timeline" tabindex="-1">
      <div class="tl-head">
        <span class="tl-title">Activity</span>
        <span class="tl-count">{{ events.length }} step{{ events.length === 1 ? "" : "s" }}{{ truncated ? "+" : "" }}</span>
        <button type="button" class="tl-close" aria-label="Close timeline" @click="emit('close')">✕</button>
      </div>
      <div class="tl-body">
        <p v-if="loading" class="tl-empty">Loading…</p>
        <p v-else-if="error" class="tl-empty">Couldn't load the timeline.</p>
        <p v-else-if="events.length === 0" class="tl-empty">No tool activity yet.</p>
        <ol v-else class="tl-list">
          <li v-for="(ev, idx) in reversed()" :key="idx" class="tl-row">
            <span class="tl-time">{{ formatTime(ev.ts) }}</span>
            <span class="tl-tool">{{ ev.tool }}</span>
            <span class="tl-summary" :title="ev.summary">{{ ev.summary }}</span>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tl-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.tl-modal {
  width: min(640px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel, #1e1e2e);
  color: var(--text, #e6e6e6);
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.tl-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
}
.tl-title {
  font-weight: 600;
}
.tl-count {
  font-size: 0.8rem;
  opacity: 0.6;
}
.tl-close {
  margin-left: auto;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 0.95rem;
}
.tl-body {
  overflow-y: auto;
  padding: 6px 0;
}
.tl-empty {
  padding: 24px 14px;
  text-align: center;
  opacity: 0.6;
}
.tl-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tl-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 5px 14px;
  font-size: 0.82rem;
}
.tl-row:nth-child(odd) {
  background: color-mix(in srgb, currentColor 5%, transparent);
}
.tl-time {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  opacity: 0.55;
  font-size: 0.75rem;
}
.tl-tool {
  flex: 0 0 auto;
  font-weight: 600;
  min-width: 4.5em;
}
.tl-summary {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, monospace;
  opacity: 0.85;
}
</style>
