<script setup lang="ts">
import { computed, ref, watch } from "vue";
import TerminalView from "./Terminal.vue";
import CellShell from "./CellShell.vue";
import { cellShellEvents } from "./cellChromeBinding";
import type { RunCommand } from "./runCommand";
import { isThumbnail, type GridCellEmits, type GridCellProps } from "./gridCell";
import { browserLocale } from "../utils/browserLocale";
import { isRecord } from "../../common/isRecord";
import { commandExitKind, notifySound } from "../composables/notifySound";
import { fireConfettiForEvent } from "../composables/useConfetti";
import { CELL_BTN, CELL_BTN_BOX, CELL_BTN_INK, CELL_BTN_SIZE, CELL_TERM } from "./cellChromeClasses";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { useI18n } from "vue-i18n";
import HostMark from "./HostMark.vue";
import RemoteHostGone from "./RemoteHostGone.vue";
import { useRemoteHostStatus } from "../composables/configuredRemoteHosts";
import { mayConnect } from "./remoteHostStatus";
import { onThisMachine } from "./remoteCell";

const { t } = useI18n();

// The summarize button's own colours, and the smaller close button on the summary panel. One complete
// string per state rather than a base plus an override: two utilities for the same property
// on one element are resolved by Tailwind's output order, not by the order written here.
const SUMMARIZE_READY = `${CELL_BTN_BOX} ${CELL_BTN_SIZE} cursor-pointer text-[#9db4ff] hover:bg-[#24305c] hover:text-[#cdd8ff]`;
const SUMMARIZE_BUSY = `${CELL_BTN_BOX} ${CELL_BTN_SIZE} cursor-default text-[#7f88ad]`;
const SUMMARY_CLOSE_BTN = `${CELL_BTN_BOX} h-[22px] w-[22px] text-[13px] ${CELL_BTN_INK}`;

// A grid cell that runs a `script.json` command (a cell launcher's Run) instead of
// a Claude session. Ephemeral: it has no session id and isn't persisted — a reload
// drops it. `command.index` is the script's position in `<command.cwd>/script.json`
// (the server resolves it); the command runs in `command.cwd`.
const props = defineProps<
  GridCellProps & {
    command: RunCommand;
    // The remote host the command runs on (#3506): its header button or script, run there.
    remoteHost?: string | null;
    // Manual sort mode: show move buttons to swap this cell with its neighbour.
    reorderable?: boolean;
  }
>();
const thumbnail = computed(() => isThumbnail(props));
const emit = defineEmits<GridCellEmits>();

const shellEvents = cellShellEvents(emit);

// The path menu and the directory's sound are this machine's, so a remote command gets neither.
const localCwd = computed(() => onThisMachine(props.remoteHost, props.command.cwd));
const hostStatus = useRemoteHostStatus(props.remoteHost);

// connectKey forces Terminal.vue to (re)connect — bumped to re-run after exit.
const connectKey = ref(0);
const finished = ref(false);
const termRef = ref<InstanceType<typeof TerminalView>>();

// A running command counts as "working"; once it exits it's idle (never "waiting").
watch(finished, (done) => emit("status", done ? "idle" : "working"), { immediate: true });

function onExit(exitCode: number | null) {
  finished.value = true;
  // A Run PTY is ephemeral: it never enters the session registry, so nothing publishes a
  // "closed" activity for it and useAttentionSound cannot see this. The cell is the only
  // place that knows the command ended, and with what status.
  notifySound(commandExitKind(exitCode), localCwd.value);
  if (exitCode === 0) fireConfettiForEvent("command-done");
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

// The summary language follows the browser's base language — MulmoTerminal has no
// locale picker (same signal as useVoiceInput / accountingUi / App.vue).

async function postSummary(log: string): Promise<{ summary: string; truncated: boolean }> {
  // No try/catch: `summarize` below is what decides how a failure is shown. The block that used
  // to be here existed only to clear the timer.
  const res = await fetchWithTimeout(
    "/api/command/summarize",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ log, locale: browserLocale() }) },
    SUMMARY_FETCH_TIMEOUT_MS,
  );
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(isRecord(data) && typeof data.error === "string" ? data.error : `request failed (${res.status})`);
  return {
    summary: isRecord(data) && typeof data.summary === "string" ? data.summary : "",
    truncated: isRecord(data) && data.truncated === true,
  };
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
</script>

<template>
  <CellShell
    :expanded="expanded"
    :right-pane="rightPane"
    :canvas-available="canvasAvailable"
    :collections-available="collectionsAvailable"
    :home="home"
    :cwd="localCwd"
    :default-cwd="defaultCwd"
    :finished="finished"
    :idle-title="t('tips.cell.finished')"
    icon="play_arrow"
    :label="command.label"
    move-noun="command"
    :reorderable="reorderable"
    :thumbnail="thumbnail"
    :row-menu="rowMenu"
    :slot-key="null"
    :panes-hidden="!!remoteHost"
    v-on="shellEvents"
    @path-problem="(message) => void termRef?.showHint(message, 'folder_open')"
  >
    <template #actions>
      <HostMark v-if="remoteHost" :host="remoteHost" />
      <button v-if="finished" class="cell-btn" :class="CELL_BTN" :data-tip="t('tips.cell.rerun')" :aria-label="t('tips.cell.rerunCommand')" @click="rerun">
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
      </button>
      <button
        class="cell-btn cell-summarize"
        :class="summaryState === 'loading' ? `is-busy ${SUMMARIZE_BUSY}` : SUMMARIZE_READY"
        :data-tip="t('tips.cell.summarize')"
        :aria-label="t('tips.cell.summarizeCommand')"
        :disabled="summaryState === 'loading'"
        @click="summarize"
      >
        <span class="material-symbols-outlined" aria-hidden="true">{{ summaryState === "loading" ? "more_horiz" : "auto_awesome" }}</span>
      </button>
    </template>
    <RemoteHostGone v-if="remoteHost && hostStatus === 'gone'" :host="remoteHost" />
    <TerminalView
      v-else-if="mayConnect(hostStatus)"
      ref="termRef"
      class="cell-term"
      :class="CELL_TERM"
      :session-id="null"
      :connect-key="connectKey"
      :cwd="command.cwd"
      :command="command"
      :remote-host="remoteHost ?? null"
      :expanded="expanded"
      :zoomed="zoomed"
      :hide-header="thumbnail"
      @exit="onExit"
    />
    <div v-if="showSummary" data-testid="cell-summary" class="flex max-h-[40%] min-h-0 flex-none flex-col border-t border-t-[#2a2a4e] bg-[#141b33]">
      <div class="flex flex-none items-center justify-between border-b border-b-[#232a48] py-0.5 pl-2.5 pr-1.5">
        <span class="inline-flex items-center gap-1 font-sans text-[11px] font-semibold text-[#9db4ff]"
          ><span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span> Summary</span
        >
        <button
          class="cell-btn cell-summary-close"
          :class="SUMMARY_CLOSE_BTN"
          :data-tip="t('tips.cell.dismissSummary')"
          :aria-label="t('tips.cell.dismissSummary')"
          @click="closeSummary"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
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
              class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#3b4a7a] bg-[#232a45] px-2.5 py-1 font-sans text-[12px] text-[#cdd6ff] hover:bg-[#2c355a]"
              :data-tip="t('tips.cell.copyAsPrompt')"
              @click="copyPrompt"
            >
              <span class="material-symbols-outlined" aria-hidden="true">{{ copied ? "check" : "content_copy" }}</span>
              {{ copied ? "Copied" : "Copy as prompt" }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </CellShell>
</template>
