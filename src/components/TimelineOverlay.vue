<script setup lang="ts">
// A read-only activity timeline for one session: the tools the agent ran (newest
// first), fetched from GET /api/transcript/timeline. Opened from the cell header's
// history button so you can see "what did it do?" without scrolling the raw transcript.
import { ref, watch, onUnmounted, nextTick } from "vue";
import { modalKeydownHandler } from "../composables/useModalKeyboard";
import { isRecord } from "../../common/isRecord";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { transcriptPath } from "./remoteCell";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

interface TimelineEvent {
  ts: string;
  tool: string;
  summary: string;
}

// `host`: the remote host the session runs on (#3506), null or absent for this machine.
const props = defineProps<{ sessionId: string | null; cwd: string | null; open: boolean; host?: string | null }>();
const emit = defineEmits<{ (e: "close"): void }>();

const events = ref<TimelineEvent[]>([]);
const truncated = ref(false);
const loading = ref(false);
const error = ref(false);
const isTimeline = (v: unknown): v is { events: TimelineEvent[]; truncated: boolean } => isRecord(v) && Array.isArray(v.events);

// Bumped per load so a slow fetch for a previously-opened session can't overwrite the
// state of a newer open (reopening quickly for a different session/cwd).
let req = 0;
async function load(): Promise<void> {
  if (!props.sessionId) return;
  const my = ++req;
  loading.value = true;
  error.value = false;
  try {
    const params = new URLSearchParams({ session: props.sessionId });
    if (props.cwd) params.set("cwd", props.cwd);
    const res = await fetchWithTimeout(transcriptPath(props.host, "timeline", params));
    if (!res.ok) throw new Error(String(res.status));
    const data: unknown = await res.json();
    if (my !== req) return; // superseded by a newer open
    events.value = isTimeline(data) ? data.events : [];
    truncated.value = isTimeline(data) && data.truncated;
  } catch {
    if (my === req) {
      error.value = true;
      events.value = [];
      truncated.value = false; // don't leak a prior load's "+"
    }
  } finally {
    if (my === req) loading.value = false;
  }
}

// Newest first for scanning recent activity.
const reversed = () => [...events.value].reverse();

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString();
};

const modalEl = ref<HTMLElement | null>(null);

// The shared modal keyboard contract, attached only while open (this overlay stays mounted while
// closed) and removed on close/unmount. The default trap selector is right here: everything the
// timeline offers is a button.
const onKeydown = modalKeydownHandler({ modalEl, onClose: () => emit("close") });

// One watch over open + identity: (re)load whenever the overlay is open — covering
// both the open transition and a session/cwd change while it stays open (so it never
// shows a previous session's activity) — and manage the key listener + initial focus
// only on the open transition.
watch(
  [() => props.open, () => props.sessionId, () => props.cwd, () => props.host],
  (vals, oldVals) => {
    const open = vals[0];
    if (!open) {
      document.removeEventListener("keydown", onKeydown);
      return;
    }
    void load();
    if (!oldVals?.[0]) {
      document.addEventListener("keydown", onKeydown);
      void nextTick(() => modalEl.value?.focus());
    }
  },
  { immediate: true },
);

onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <!-- Teleported to body, NOT rendered in place (#968). This root is `fixed`, and the cell it
       is used from grows with `transform: scale` while focused — a transformed ancestor becomes
       the containing block for `position: fixed`, so the modal took the CELL's rect instead of
       the viewport's and the cell's `overflow: hidden` cropped the rest. Clicking the header's
       history button focuses that cell, so the ordinary path into this modal was the broken one.
       On the definition rather than at the call site: the component is then correct wherever it
       is used. -->
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.45)]" @click.self="emit('close')">
      <div
        ref="modalEl"
        data-testid="tl-modal"
        class="flex max-h-[80vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-lg bg-panel text-fg shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
        role="dialog"
        aria-modal="true"
        :aria-label="t('tips.panes.timeline')"
        tabindex="-1"
      >
        <div class="flex items-center gap-2 border-b border-b-[color-mix(in_srgb,currentColor_15%,transparent)] px-3.5 py-2.5">
          <span class="font-semibold">Activity</span>
          <span data-testid="tl-count" class="text-[0.8rem] opacity-60"
            >{{ events.length }} step{{ events.length === 1 ? "" : "s" }}{{ truncated ? "+" : "" }}</span
          >
          <button
            type="button"
            data-testid="tl-close"
            class="ml-auto cursor-pointer border-0 bg-transparent text-[0.95rem] text-inherit"
            :aria-label="t('tips.panes.closeTimeline')"
            @click="emit('close')"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="overflow-y-auto py-1.5">
          <p v-if="loading" data-testid="tl-empty" class="px-3.5 py-6 text-center opacity-60">Loading…</p>
          <p v-else-if="error" data-testid="tl-empty" class="px-3.5 py-6 text-center opacity-60">Couldn't load the timeline.</p>
          <p v-else-if="events.length === 0" data-testid="tl-empty" class="px-3.5 py-6 text-center opacity-60">No tool activity yet.</p>
          <ol v-else class="m-0 list-none p-0">
            <li
              v-for="(ev, idx) in reversed()"
              :key="idx"
              data-testid="tl-row"
              class="flex items-baseline gap-2.5 px-3.5 py-[5px] text-[0.82rem] odd:bg-[color-mix(in_srgb,currentColor_5%,transparent)]"
            >
              <span class="flex-none text-[0.75rem] tabular-nums opacity-[0.55]">{{ formatTime(ev.ts) }}</span>
              <span data-testid="tl-tool" class="min-w-[4.5em] flex-none font-semibold">{{ ev.tool }}</span>
              <span class="flex-auto truncate font-[ui-monospace,monospace] opacity-85" :data-tip="ev.summary">{{ ev.summary }}</span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  </Teleport>
</template>
