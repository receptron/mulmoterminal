<script setup lang="ts">
import { computed, ref, watch } from "vue";
import TerminalView from "./Terminal.vue";
import { formatCwd } from "./cwdDisplay";
import { shouldZoomOnHeaderClick } from "./cellHeaderZoom";
import type { CellStatus } from "./gridTabs";

// A grid cell that runs a `script.json` command (a cell launcher's Run) instead of
// a Claude session. Ephemeral: it has no session id and isn't persisted — a reload
// drops it. `command.index` is the script's position in `<command.cwd>/script.json`
// (the server resolves it); the command runs in `command.cwd`.
const props = defineProps<{
  expanded: boolean;
  command: { index: number; label: string; cwd: string | null };
  home: string | null;
  // Manual sort mode: show ◀▶ to swap this cell with its neighbour.
  reorderable?: boolean;
}>();
const emit = defineEmits<{
  (e: "toggle-expand" | "close"): void;
  // Swap this cell left (-1) or right (+1) in manual sort mode.
  (e: "move", dir: -1 | 1): void;
  // Report activity up so the grid can attention-sort in auto mode.
  (e: "status", value: CellStatus): void;
}>();

// connectKey forces Terminal.vue to (re)connect — bumped to re-run after exit.
const connectKey = ref(0);
const finished = ref(false);
const termRef = ref<InstanceType<typeof TerminalView>>();

const dirDisplay = computed(() => formatCwd(props.command.cwd, props.home));

// A running command counts as "working"; once it exits it's idle (never "waiting").
watch(finished, (done) => emit("status", done ? "idle" : "working"), { immediate: true });

function onExit() {
  finished.value = true;
}

function rerun() {
  finished.value = false;
  connectKey.value++;
}

// AI "Summarize / Explain": send the cell's captured terminal output to the server,
// which runs `claude -p` headless and returns a short Errors/Warnings/cause/fix note.
type SummaryState = "idle" | "loading" | "done" | "error";
const summaryState = ref<SummaryState>("idle");
const summaryText = ref("");
const summaryError = ref("");
const summaryTruncated = ref(false);
const showSummary = ref(false);

// A local terminal request, but still bounded: don't wait forever on a hung CLI.
const SUMMARY_FETCH_TIMEOUT_MS = 90_000;
// Client-side cap on the bytes sent (the server re-caps to its own tail limit).
const MAX_SEND_CHARS = 64 * 1024;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// The summary language follows the browser's base language — MulmoTerminal has no
// locale picker (same signal as useVoiceInput / accountingUi / App.vue).
const browserLocale = (): string => (navigator.language || "en").split("-")[0];

async function postSummary(log: string): Promise<{ summary: string; truncated: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUMMARY_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/command/summarize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ log, locale: browserLocale() }),
      signal: controller.signal,
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(isRecord(data) && typeof data.error === "string" ? data.error : `request failed (${res.status})`);
    return {
      summary: isRecord(data) && typeof data.summary === "string" ? data.summary : "",
      truncated: isRecord(data) && data.truncated === true,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function summarize() {
  summaryState.value = "loading";
  showSummary.value = true;
  summaryError.value = "";
  summaryText.value = "";
  try {
    const { summary, truncated } = await postSummary((termRef.value?.readOutput() ?? "").slice(-MAX_SEND_CHARS));
    summaryText.value = summary;
    summaryTruncated.value = truncated;
    summaryState.value = "done";
  } catch (e) {
    summaryError.value = e instanceof Error ? e.message : String(e);
    summaryState.value = "error";
  }
}

function closeSummary() {
  showSummary.value = false;
}

// Copy the command + summary as a ready-to-paste prompt, so the user can drop it into
// whatever Claude session they choose (a grid cell in this dir, the single view, …)
// and take it from there — no forced view switch. Multi-line survives the clipboard.
const copied = ref(false);
function copyPrompt() {
  const lines = [`Command: ${props.command.label}`];
  if (props.command.cwd) lines.push(`Directory: ${props.command.cwd}`);
  lines.push("", "Summary of its output:", summaryText.value.trim(), "", "Follow-up: ");
  navigator.clipboard
    .writeText(lines.join("\n"))
    .then(() => {
      copied.value = true;
      setTimeout(() => (copied.value = false), 1500);
    })
    .catch(() => {
      // clipboard blocked (no focus / permission) — nothing to fall back to here
    });
}

// Click the header background to zoom (switch to) this cell; buttons keep their action.
function onHeaderClick(event: MouseEvent) {
  if (shouldZoomOnHeaderClick(event.target, props.expanded)) emit("toggle-expand");
}
</script>

<template>
  <div class="cell">
    <div class="cell-header" :class="{ 'is-zoomable': !expanded }" @click="onHeaderClick">
      <span class="cell-dot" :class="finished ? 'is-idle' : 'is-working'" :title="finished ? 'Finished' : 'Running…'" />
      <span v-if="dirDisplay" class="cell-dir" :title="command.cwd ?? ''"
        ><span class="cell-dir-path">{{ dirDisplay }}</span></span
      >
      <span class="cell-cmd">▶ {{ command.label }}</span>
      <span class="cell-actions">
        <button v-if="reorderable" class="cell-btn" title="Move left" aria-label="Move command left" @click="emit('move', -1)">◀</button>
        <button v-if="reorderable" class="cell-btn" title="Move right" aria-label="Move command right" @click="emit('move', 1)">▶</button>
        <button v-if="finished" class="cell-btn" title="Re-run" aria-label="Re-run command" @click="rerun">↻</button>
        <button
          class="cell-btn cell-summarize"
          :class="{ 'is-busy': summaryState === 'loading' }"
          title="Summarize output (AI)"
          aria-label="Summarize command output"
          :disabled="summaryState === 'loading'"
          @click="summarize"
        >
          {{ summaryState === "loading" ? "⋯" : "✦" }}
        </button>
        <button
          class="cell-btn"
          :title="expanded ? 'Restore' : 'Expand'"
          :aria-label="expanded ? 'Restore terminal' : 'Expand terminal'"
          @click="emit('toggle-expand')"
        >
          {{ expanded ? "⤡" : "⤢" }}
        </button>
        <button class="cell-btn cell-close" title="Close terminal" aria-label="Close terminal" @click="emit('close')">✕</button>
      </span>
    </div>
    <TerminalView ref="termRef" class="cell-term" :session-id="null" :connect-key="connectKey" :cwd="command.cwd" :command="command" @exit="onExit" />
    <div v-if="showSummary" class="cell-summary">
      <div class="cell-summary-head">
        <span class="cell-summary-title">✦ Summary</span>
        <button class="cell-btn cell-summary-close" title="Dismiss summary" aria-label="Dismiss summary" @click="closeSummary">✕</button>
      </div>
      <div class="cell-summary-body">
        <span v-if="summaryState === 'loading'" class="cell-summary-loading">Summarizing…</span>
        <p v-else-if="summaryState === 'error'" class="cell-summary-error">{{ summaryError }}</p>
        <template v-else>
          <pre class="cell-summary-text">{{ summaryText }}</pre>
          <p v-if="summaryTruncated" class="cell-summary-note">(long output — summarized the tail only)</p>
          <div class="cell-summary-actions">
            <button type="button" class="cell-summary-continue" title="Copy this as a prompt to paste into a Claude session" @click="copyPrompt">
              {{ copied ? "✓ Copied" : "⧉ Copy as prompt" }}
            </button>
          </div>
        </template>
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
/* Header background is a click target: zoom (switch to) this cell. */
.cell-header.is-zoomable {
  cursor: pointer;
}
.cell-header.is-zoomable:hover {
  background: #1c2a4e;
}

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
  /* Floor the width at ~15 chars of the path so the current dir stays readable
     even on a narrow cell (1ch ≈ one monospace char; the leading … takes one). */
  min-width: 16ch;
  max-width: 45%;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: #7f88ad;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Truncate from the FRONT so the tail (the project dir) stays visible. */
  direction: rtl;
  /* Left-align so a short path hugs the dot instead of floating right (rtl). */
  text-align: left;
}
.cell-dir-path {
  unicode-bidi: plaintext;
}
.cell-cmd {
  flex: 1 1 auto;
  min-width: 0;
  font-family: ui-monospace, "JetBrains Mono", monospace;
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

.cell-summarize {
  color: #9db4ff;
}
.cell-summarize:hover {
  background: #24305c;
  color: #cdd8ff;
}
.cell-summarize.is-busy {
  color: #7f88ad;
  cursor: default;
}

.cell-term {
  flex: 1;
  min-height: 0;
}

/* Result panel: a short, scrollable strip below the terminal (never steals more than
   ~40% of the cell). */
.cell-summary {
  flex: 0 0 auto;
  max-height: 40%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #141b33;
  border-top: 1px solid #2a2a4e;
}
.cell-summary-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 6px 2px 10px;
  border-bottom: 1px solid #232a48;
}
.cell-summary-title {
  font-family: system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: #9db4ff;
}
.cell-summary-close {
  width: 22px;
  height: 22px;
  font-size: 13px;
}
.cell-summary-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px 10px 8px;
}
.cell-summary-loading {
  font-family: system-ui, sans-serif;
  font-size: 12px;
  color: #7f88ad;
}
.cell-summary-error {
  margin: 0;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  color: #ff8a8a;
  white-space: pre-wrap;
  word-break: break-word;
}
.cell-summary-text {
  margin: 0;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #d6dcf5;
  white-space: pre-wrap;
  word-break: break-word;
}
.cell-summary-note {
  margin: 6px 0 0;
  font-family: system-ui, sans-serif;
  font-size: 11px;
  color: #7f88ad;
}
.cell-summary-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}
.cell-summary-continue {
  border: 1px solid #3b4a7a;
  background: #232a45;
  color: #cdd6ff;
  border-radius: 6px;
  padding: 4px 10px;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  cursor: pointer;
}
.cell-summary-continue:hover {
  background: #2c355a;
}
</style>
