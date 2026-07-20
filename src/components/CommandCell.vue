<script setup lang="ts">
import { computed, ref, watch } from "vue";
import TerminalView from "./Terminal.vue";
import type { RunCommand } from "./runCommand";
import { formatCwd } from "./cwdDisplay";
import { shouldZoomOnHeaderClick } from "./cellHeaderZoom";
import type { CellStatus } from "./gridTabs";

// A grid cell that runs a `script.json` command (a cell launcher's Run) instead of
// a Claude session. Ephemeral: it has no session id and isn't persisted — a reload
// drops it. `command.index` is the script's position in `<command.cwd>/script.json`
// (the server resolves it); the command runs in `command.cwd`.
const props = defineProps<{
  expanded: boolean;
  // True while SOME cell in the grid is zoomed → this cell is a filmstrip thumbnail
  // (unless it's the zoomed one). Only then does a header-background click zoom it.
  zoomed?: boolean;
  command: RunCommand;
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
  // The Clipboard API is absent on insecure origins (a LAN IP, not localhost) and some
  // webviews; guard so a click can't throw synchronously. Nothing to fall back to here.
  if (!navigator.clipboard?.writeText) return;
  navigator.clipboard
    .writeText(lines.join("\n"))
    .then(() => {
      copied.value = true;
      setTimeout(() => (copied.value = false), 1500);
    })
    .catch(() => {
      // clipboard blocked (no focus / permission) — leave the button label unchanged
    });
}

// Clicking the header background zooms (switches to) this cell, except the already-
// expanded one. Buttons keep their action.
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
    <TerminalView
      ref="termRef"
      class="cell-term"
      :session-id="null"
      :connect-key="connectKey"
      :cwd="command.cwd"
      :command="command"
      :expanded="expanded"
      :zoomed="zoomed"
      @exit="onExit"
    />
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

<style scoped src="./cellChromeBase.css"></style>
<style scoped src="./cellChrome.css"></style>

<style scoped>
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
