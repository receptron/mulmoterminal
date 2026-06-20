<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, useTemplateRef } from "vue";
import TerminalView from "./Terminal.vue";
import { usePubSub } from "../composables/usePubSub";
import { formatCwd } from "./cwdDisplay";
import type { CwdPreset } from "./presets";

const termRef = useTemplateRef<InstanceType<typeof TerminalView>>("termRef");

// `expanded` reflects whether this cell is zoomed to fill the grid (parent owns
// the state). `initialSessionId` resumes a session on mount (reload restore).
// `initialCwd` is this cell's persisted working dir; `defaultCwd` is the server
// default used to prefill the launch form; `presets` are quick-pick dirs; `home`
// is the server home dir (to anchor the header path on ~).
const props = defineProps<{
  expanded: boolean;
  initialSessionId: string | null;
  initialCwd: string | null;
  defaultCwd: string | null;
  presets: CwdPreset[];
  home: string | null;
}>();
const emit = defineEmits<{ (e: "toggle-expand" | "close"): void; (e: "session" | "cwd", value: string): void }>();

// A cell with a persisted session relaunches (resumes) on mount; otherwise it
// starts empty and lazy-launches when the user picks a dir and clicks Start.
const launched = ref(props.initialSessionId !== null);
const sessionId = ref<string | null>(props.initialSessionId);
const connectKey = ref(0);

// The directory this terminal runs in (shown in the header, sent to the server).
const cwd = ref<string | null>(props.initialCwd ?? props.defaultCwd);
// The launch form's editable dir; prefilled with the default once it's fetched.
const dirInput = ref(props.initialCwd ?? props.defaultCwd ?? "");
watch(
  () => props.defaultCwd,
  (d) => {
    if (!d) return;
    if (!dirInput.value) dirInput.value = d;
    if (cwd.value === null) cwd.value = d;
  },
);

// Live activity for this session, from the "sessions" pub/sub channel.
const working = ref(false);
const waiting = ref(false);
const lastPrompt = ref<string | null>(null);

const { subscribe } = usePubSub();
let unsubscribe: (() => void) | null = null;

interface ActivityMsg {
  id: string;
  working?: boolean;
  waiting?: boolean;
  lastPrompt?: string | null;
}
const isActivityMsg = (d: unknown): d is ActivityMsg => typeof d === "object" && d !== null && "id" in d;

function applyActivity(d: ActivityMsg) {
  working.value = d.working ?? false;
  waiting.value = d.waiting ?? false;
  // Apply lastPrompt whenever the field is present — including an explicit null,
  // so a cleared/new session doesn't keep showing the previous prompt.
  if (d.lastPrompt !== undefined) lastPrompt.value = d.lastPrompt;
}

async function loadInitial(id: string) {
  try {
    const res = await fetch(`/api/session/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    // Guard against a stale response: the cell may have closed / switched session
    // while the fetch was in flight — don't leak old status into the new state.
    if (id === sessionId.value) applyActivity(data);
  } catch {
    // best-effort — pub/sub will fill it in on the next event
  }
}

onMounted(() => {
  unsubscribe = subscribe("sessions", (d) => {
    if (isActivityMsg(d) && d.id === sessionId.value) applyActivity(d);
  });
  if (sessionId.value) loadInitial(sessionId.value);
  else loadResumable();
});
onUnmounted(() => {
  unsubscribe?.();
  if (resumableTimer) clearTimeout(resumableTimer);
});

function launch() {
  // Optimistic display only; the persisted/displayed truth is the EFFECTIVE cwd
  // the server confirms (onServerCwd), since it may fall back from a bad path.
  cwd.value = dirInput.value.trim() || props.defaultCwd;
  sessionId.value = null; // new session — the server generates the id
  connectKey.value++;
  launched.value = true;
}

// Pick a preset directory: fill the field and refresh the resume list for it, so
// the user can then start fresh OR resume one of that dir's sessions.
function selectPreset(p: CwdPreset) {
  dirInput.value = p.path;
  loadResumable();
}

// Existing sessions for the dir in the form, so an empty cell can resume one
// instead of starting fresh.
interface ResumableSession {
  id: string;
  title: string;
  mtime: number;
}
const resumable = ref<ResumableSession[]>([]);
// The resolved cwd the listed sessions belong to (the server may resolve/fallback
// the requested dir). resume() uses THIS — not the live input — so the session id
// and cwd always match the row that was clicked.
const resumableCwd = ref<string | null>(null);
let resumableTimer: ReturnType<typeof setTimeout> | null = null;
let resumableReq = 0; // request token: drop out-of-order responses

async function loadResumable() {
  const dir = dirInput.value.trim() || props.defaultCwd;
  const reqId = ++resumableReq;
  if (launched.value || !dir) {
    resumable.value = [];
    resumableCwd.value = null;
    return;
  }
  try {
    const res = await fetch(`/api/sessions?cwd=${encodeURIComponent(dir)}`);
    if (reqId !== resumableReq) return; // a newer request superseded this one
    const data = res.ok ? await res.json() : { sessions: [], cwd: dir };
    if (reqId !== resumableReq) return; // re-check after awaiting the body
    resumable.value = data.sessions ?? [];
    resumableCwd.value = data.cwd ?? dir;
  } catch {
    if (reqId === resumableReq) {
      resumable.value = [];
      resumableCwd.value = null;
    }
  }
}

// Refresh the resume list when the target dir changes (debounced).
watch([dirInput, () => props.defaultCwd], () => {
  if (resumableTimer) clearTimeout(resumableTimer);
  resumableTimer = setTimeout(loadResumable, 300);
});

function resume(s: ResumableSession) {
  // Use the cwd those rows were fetched for, not the (possibly-changed) input.
  cwd.value = resumableCwd.value ?? (dirInput.value.trim() || props.defaultCwd);
  sessionId.value = s.id;
  connectKey.value++;
  launched.value = true;
}

function relativeTime(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// The server reports where the PTY actually runs (it may have rejected the
// requested dir). Adopt it as the truth — display and persist the effective cwd.
function onServerCwd(c: string) {
  cwd.value = c;
  emit("cwd", c);
}

function close() {
  // Ask the server to reap this session immediately (don't hold it through the
  // disconnect grace window), then tear the cell down.
  termRef.value?.terminate();
  launched.value = false;
  sessionId.value = null;
  working.value = false;
  waiting.value = false;
  lastPrompt.value = null;
  // The cell isn't remounted (stable key), so reset the dir state too — otherwise
  // the empty launch form would still show the closed session's directory.
  cwd.value = props.defaultCwd;
  dirInput.value = props.defaultCwd ?? "";
  emit("close");
  loadResumable();
}

// Adopt the server-assigned id (esp. for new sessions), bubble it up for
// persistence, and load its initial activity.
function onSession(id: string) {
  sessionId.value = id;
  emit("session", id);
  loadInitial(id);
}

// ~-anchored, front-truncated path for the header (keeps the tail).
const dirDisplay = computed(() => formatCwd(cwd.value, props.home));

// Attention (waiting) wins over working wins over idle.
const status = computed<"waiting" | "working" | "idle">(() => {
  if (waiting.value) return "waiting";
  if (working.value) return "working";
  return "idle";
});
const STATUS_CLASS = { waiting: "is-waiting", working: "is-working", idle: "is-idle" } as const;
const STATUS_LABEL = { waiting: "Needs attention", working: "Working…", idle: "Idle" } as const;
const statusClass = computed(() => STATUS_CLASS[status.value]);
const statusLabel = computed(() => STATUS_LABEL[status.value]);

const headerText = computed(() => lastPrompt.value || (sessionId.value ? sessionId.value.slice(0, 8) : "starting…"));
</script>

<template>
  <div class="cell">
    <template v-if="launched">
      <div class="cell-header">
        <span class="cell-dot" :class="statusClass" :title="statusLabel" />
        <span v-if="dirDisplay" class="cell-dir" :title="cwd ?? ''">{{ dirDisplay }}</span>
        <span class="cell-prompt" :title="lastPrompt ?? ''">{{ headerText }}</span>
        <span class="cell-actions">
          <button
            class="cell-btn"
            :title="expanded ? 'Restore' : 'Expand'"
            :aria-label="expanded ? 'Restore terminal' : 'Expand terminal'"
            @click="emit('toggle-expand')"
          >
            {{ expanded ? "⤡" : "⤢" }}
          </button>
          <button class="cell-btn cell-close" title="Close terminal" aria-label="Close terminal" @click="close">✕</button>
        </span>
      </div>
      <TerminalView
        ref="termRef"
        class="cell-term"
        :session-id="sessionId"
        :connect-key="connectKey"
        :cwd="cwd"
        dev-terminal
        @session="onSession"
        @cwd="onServerCwd"
      />
    </template>
    <div v-else class="cell-launch">
      <div v-if="presets.length" class="cell-presets">
        <button v-for="p in presets" :key="p.label + p.path" :class="['cell-preset', { active: dirInput === p.path }]" :title="p.path" @click="selectPreset(p)">
          {{ p.label }}
        </button>
      </div>
      <label class="cell-launch-label">
        <span class="cell-launch-caption">Working directory</span>
        <input v-model="dirInput" class="cell-dir-input" type="text" placeholder="/path/to/project" spellcheck="false" @keydown.enter="launch" />
      </label>
      <button class="cell-start" @click="launch">＋ New terminal</button>
      <div v-if="resumable.length" class="cell-resume">
        <span class="cell-launch-caption">or resume here</span>
        <div class="cell-resume-list">
          <button v-for="s in resumable" :key="s.id" class="cell-resume-item" :title="s.title" @click="resume(s)">
            <span class="ri-title">{{ s.title }}</span>
            <span class="ri-time">{{ relativeTime(s.mtime) }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #1a1a2e;
  border: 1px solid #2a2a4e;
  border-radius: 6px;
  overflow: hidden;
}

.cell-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  background: #16213e;
  border-bottom: 1px solid #2a2a4e;
}

/* Status dot: idle / working (pulsing) / waiting (attention). */
.cell-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #4a5070;
}
.cell-dot.is-working {
  background: #4a8cff;
  animation: pulse 1.2s ease-in-out infinite;
}
.cell-dot.is-waiting {
  background: #ffb454;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.cell-dir {
  flex: 0 1 auto;
  max-width: 60%;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: #7f88ad;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-prompt {
  flex: 1 1 auto;
  min-width: 0;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  color: #c7cdf0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
}
.cell-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: none;
  background: transparent;
  color: #c7cdf0;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  border-radius: 6px;
}
.cell-btn:hover {
  background: #2a3b66;
  color: #e6e6f0;
}
.cell-close:hover {
  background: #3a2030;
  color: #ff6b6b;
}

.cell-term {
  flex: 1;
  min-height: 0;
}

/* Empty cell: pick a directory, then launch. */
.cell-launch {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
}
.cell-presets {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  max-width: 360px;
}
.cell-preset {
  border: 1px solid #2a2a4e;
  background: #20203a;
  color: #c7cdf0;
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 14px;
}
.cell-preset:hover {
  background: #2a3b66;
  color: #fff;
}
.cell-preset.active {
  background: #2a3b66;
  color: #fff;
  border-color: #4a8cff;
}
.cell-launch-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  max-width: 360px;
}
.cell-launch-caption {
  font-family: system-ui, sans-serif;
  font-size: 11px;
  color: #6b7394;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.cell-dir-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  background: #11111f;
  border: 1px solid #2a2a4e;
  border-radius: 6px;
  color: #e6e6f0;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
}
.cell-dir-input:focus {
  outline: none;
  border-color: #4a8cff;
}
.cell-start {
  border: 1px solid #2a2a4e;
  background: #20203a;
  color: #c7cdf0;
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 14px;
  font-weight: 500;
  padding: 7px 16px;
  border-radius: 6px;
}
.cell-start:hover {
  background: #2a3b66;
  color: #fff;
}

.cell-resume {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  max-width: 360px;
  min-height: 0;
}
.cell-resume-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-height: 160px;
  overflow-y: auto;
}
.cell-resume-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #2a2a4e;
  background: #14142a;
  color: #c7cdf0;
  cursor: pointer;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  text-align: left;
  padding: 5px 10px;
  border-radius: 6px;
}
.cell-resume-item:hover {
  background: #20203a;
  border-color: #4a8cff;
}
.ri-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ri-time {
  flex: 0 0 auto;
  color: #6b7394;
  font-size: 11px;
}
</style>
