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
    <div v-if="showSummary" data-testid="cell-summary" class="flex max-h-[40%] min-h-0 flex-none flex-col border-t border-t-[#2a2a4e] bg-[#141b33]">
      <div class="flex flex-none items-center justify-between border-b border-b-[#232a48] py-0.5 pl-2.5 pr-1.5">
        <span class="font-sans text-[11px] font-semibold text-[#9db4ff]">✦ Summary</span>
        <button class="cell-btn cell-summary-close" title="Dismiss summary" aria-label="Dismiss summary" @click="closeSummary">✕</button>
      </div>
      <div class="min-h-0 flex-auto overflow-auto px-2.5 pb-2 pt-1.5">
        <span v-if="summaryState === 'loading'" class="font-sans text-[12px] text-[#7f88ad]">Summarizing…</span>
        <p
          v-else-if="summaryState === 'error'"
          data-testid="cell-summary-error"
          class="m-0 font-mono text-[12px] text-[#ff8a8a] whitespace-pre-wrap [word-break:break-word]"
        >
          {{ summaryError }}
        </p>
        <template v-else>
          <!-- v-text (not {{ }}): keeps the summary's exact bytes and is immune to a
               formatter wrapping the interpolation onto its own indented line inside <pre>. -->
          <pre
            data-testid="cell-summary-text"
            class="m-0 font-mono text-[12px] leading-[1.5] text-[#d6dcf5] whitespace-pre-wrap [word-break:break-word]"
            v-text="summaryText"
          ></pre>
          <p v-if="summaryTruncated" data-testid="cell-summary-note" class="mt-1.5 font-sans text-[11px] text-[#7f88ad]">
            (long output — summarized the tail only)
          </p>
          <div class="mt-2 flex justify-end">
            <button
              type="button"
              data-testid="cell-summary-continue"
              class="cursor-pointer rounded-md border border-[#3b4a7a] bg-[#232a45] px-2.5 py-1 font-sans text-[12px] text-[#cdd6ff] hover:bg-[#2c355a]"
              title="Copy this as a prompt to paste into a Claude session"
              @click="copyPrompt"
            >
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

<!-- These two buttons carry the shared .cell-btn class (cellChromeBase.css). That
     rule is unlayered scoped CSS, which beats Tailwind's layered utilities, so their
     per-instance overrides (colour, size) can't move to utilities until the shared
     chrome itself is converted — kept scoped for now. -->
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
.cell-summary-close {
  width: 22px;
  height: 22px;
  font-size: 13px;
}
</style>
