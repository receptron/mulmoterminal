<script setup lang="ts">
// The prompts YOU sent this session, newest first — the mirror of the tools pane, which shows
// what the agent then did with them (#1748).
//
// Read from GET /api/transcript/prompts, which reads the log that holds what a person typed:
// claude's own ~/.claude/history.jsonl, codex's rollout. That is why the AGENT is a prop — the
// server cannot tell from the id alone which log to open.
import { computed, onUnmounted, ref, watch } from "vue";
import { usePubSub } from "../composables/usePubSub";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import type { TerminalAgent } from "../../common/sessionAgent";
import { readPrompt, type PromptEntry } from "../../common/promptHistory";
import { PROMPT_SUBMITTED_CHANNEL, isPromptSubmittedEvent } from "../../common/promptChannel";
import { REMOTE_PROMPT_SUBMITTED_CHANNEL, parseRemotePromptSubmitted } from "../../common/remoteHosts";
import { transcriptPath } from "./remoteCell";
import { isTextSelected } from "./textSelected";
import { clockLabel } from "./clockLabel";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  sessionId: string | null;
  cwd: string | null;
  agent: TerminalAgent;
  /** The remote host the session runs on (#3506), null or absent for this machine. */
  host?: string | null;
  // Whether this pane currently covers the terminal area. Owned by the grid, shown here because
  // the button that flips it lives in this header — the same contract ToolsPane has.
  expanded?: boolean;
}>();
const emit = defineEmits<{ close: []; toggleExpand: [] }>();

const prompts = ref<PromptEntry[]>([]);
const truncated = ref(false);
const loading = ref(false);
const failed = ref(false);

// `loading` too: the early return below bumps `req`, so a request already in flight fails its
// own `my === req` check and never reaches the `finally` that would clear it. Left set, the pane
// says "Loading…" over a cell that has nothing to load (CodeRabbit, #1749).
const clear = (): void => {
  prompts.value = [];
  truncated.value = false;
  failed.value = false;
  loading.value = false;
};

// Bumped per load, so a slow fetch for the cell you just walked away from cannot overwrite the
// prompts of the one now enlarged.
let req = 0;
/** `reset` is for a load that changed WHICH session is being shown: the rows on screen belong to
 *  the cell you just left, and a slow request would leave them under the new cell's header as if
 *  they were its own (Codex, #1749). A refresh of the SAME session must not do it — the pane would
 *  blink empty every time a prompt is submitted. */
async function load(reset: boolean): Promise<void> {
  const sessionId = props.sessionId;
  const my = ++req;
  if (reset) clear();
  if (!sessionId) {
    clear();
    return;
  }
  loading.value = true;
  try {
    const params = new URLSearchParams({ session: sessionId, agent: props.agent });
    if (props.cwd) params.set("cwd", props.cwd);
    const res = await fetchWithTimeout(transcriptPath(props.host, "prompts", params));
    if (!res.ok) throw new Error(String(res.status));
    const body = await jsonBody(res);
    if (my !== req) return; // superseded
    const rows = isRecord(body) && isUnknownArray(body.prompts) ? body.prompts : [];
    prompts.value = rows.flatMap((row) => readPrompt(row) ?? []);
    truncated.value = isRecord(body) && body.truncated === true;
    failed.value = false;
  } catch {
    if (my === req) {
      failed.value = true;
      prompts.value = [];
      truncated.value = false;
    }
  } finally {
    if (my === req) loading.value = false;
  }
}

// Newest first: the pane is read from the top, and the prompt you are trying to remember is
// almost always a recent one.
const newestFirst = computed(() => [...prompts.value].reverse());

// A pane left open should keep up by itself, off a channel of its own rather than the `sessions`
// activity row. The row was the obvious source and is the wrong one: an activity publish is
// suppressed when the flag does not MOVE, so a prompt typed into a turn that is already running
// announces nothing — and that prompt, the interruption, is the case this pane exists for
// (#1748, found by Codex on #1749). See common/promptChannel.ts.
//
// Delayed, because the signal comes from the HOOK and the line is written by claude: on the
// instant, the read can land just before the file grows. 400ms is invisible to a reader and folds
// a burst into one read.
const RELOAD_DELAY_MS = 400;
let reloadTimer: ReturnType<typeof window.setTimeout> | undefined;
function scheduleReload(): void {
  window.clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => void load(false), RELOAD_DELAY_MS);
}

const { subscribe } = usePubSub();
const unsubscribeLocal = subscribe(PROMPT_SUBMITTED_CHANNEL, (data: unknown) => {
  if (!props.host && isPromptSubmittedEvent(data) && data.sessionId === props.sessionId) scheduleReload();
});
// A remote session's prompts are announced by its host, relayed with the host's name (#3506).
const unsubscribeRemote = subscribe(REMOTE_PROMPT_SUBMITTED_CHANNEL, (data: unknown) => {
  const prompt = parseRemotePromptSubmitted(data);
  if (prompt && props.host && prompt.host === props.host && prompt.sessionId === props.sessionId) scheduleReload();
});

// One watch over the identity: the pane stays mounted while the grid walks the zoom from cell to
// cell, so a changed session/agent has to reload rather than keep another terminal's prompts.
watch([() => props.sessionId, () => props.agent, () => props.cwd, () => props.host], () => void load(true), { immediate: true });

onUnmounted(() => {
  window.clearTimeout(reloadTimer);
  unsubscribeLocal();
  unsubscribeRemote();
});

// The time is INSIDE the toggle, so a label naming only the action would replace it in the
// accessible name and cost a screen reader the one thing that places the prompt in time.
const toggleLabel = (at: number | null, isOpen: boolean): string =>
  [clockLabel(at), isOpen ? t("tips.panes.collapsePrompt") : t("tips.panes.showWholePrompt")].filter(Boolean).join(" ");

// Which rows are showing their full text. A long prompt is clamped so the list stays scannable,
// and clicking one opens it in place — the pane reads, and this is still reading.
const opened = ref(new Set<number>());
function toggle(index: number): void {
  const next = new Set(opened.value);
  if (!next.delete(index)) next.add(index);
  opened.value = next;
}
// Clicking the text opens it too, EXCEPT when that click is the end of a drag: the row would
// collapse under the selection the reader just made, which is the whole reason the text is
// outside the button.
function toggleUnlessSelecting(index: number): void {
  if (isTextSelected(window.getSelection())) return;
  toggle(index);
}
// Keyed by index, so a reload that prepends rows must not leave an older row expanded by
// coincidence.
watch(prompts, () => {
  opened.value = new Set();
});
</script>

<template>
  <section class="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-deep">
    <div class="flex items-center justify-between bg-panel px-4 py-2 font-sans text-[14px] text-fg">
      <div class="flex items-baseline gap-2">
        <span class="font-semibold">Prompts</span>
        <span data-testid="prompts-count" class="text-[11px] text-dim">{{ prompts.length }}{{ truncated ? "+" : "" }}</span>
      </div>
      <!-- Expand then close, in that order, as in the Tools and Canvas headers: the panes share
           one slot, so the same control has to be in the same place in all of them. -->
      <div class="flex items-center gap-1">
        <button
          type="button"
          data-testid="prompts-expand-btn"
          class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
          :data-tip="expanded ? t('tips.panes.prompts.restore') : t('tips.panes.prompts.expand')"
          :aria-label="expanded ? t('tips.panes.prompts.restoreAria') : t('tips.panes.prompts.expandAria')"
          :aria-pressed="expanded === true"
          @click="emit('toggleExpand')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">{{ expanded ? "close_fullscreen" : "open_in_full" }}</span>
        </button>
        <button
          type="button"
          data-testid="prompts-close-btn"
          class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
          :data-tip="t('tips.panes.prompts.close')"
          :aria-label="t('tips.panes.prompts.close')"
          @click="emit('close')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">right_panel_close</span>
        </button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto font-sans text-[13px] text-fg">
      <p v-if="loading && prompts.length === 0" data-testid="prompts-empty" class="px-4 py-6 text-center text-[12px] text-dim">Loading…</p>
      <p v-else-if="failed" data-testid="prompts-empty" class="px-4 py-6 text-center text-[12px] text-dim">Couldn't read this session's prompts.</p>
      <p v-else-if="!sessionId" data-testid="prompts-empty" class="px-4 py-6 text-center text-[12px] text-dim">This cell hasn't started a session yet.</p>
      <p v-else-if="prompts.length === 0" data-testid="prompts-empty" class="px-4 py-6 text-center text-[12px] text-dim">Nothing sent to this session yet.</p>
      <ol v-else class="m-0 list-none p-0">
        <!-- The prompt text sits OUTSIDE the button on purpose. A browser makes a button's own
             content unselectable, so while the whole row was one button a reader could not drag
             across their own prompt to copy it — only re-type it. Same shape as the tools pane:
             the control is the header line, the prose is a sibling. -->
        <li
          v-for="(prompt, index) in newestFirst"
          :key="index"
          data-testid="prompt-row"
          class="border-b border-border px-3 py-2 last:border-b-0 hover:bg-subtle"
        >
          <button
            type="button"
            class="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-0 text-left text-inherit"
            :aria-expanded="opened.has(index)"
            :aria-label="toggleLabel(prompt.at, opened.has(index))"
            :data-tip="opened.has(index) ? t('tips.panes.collapse') : t('tips.panes.showWholePrompt')"
            @click="toggle(index)"
          >
            <span data-testid="prompt-time" class="text-[11px] tabular-nums text-dim">{{ clockLabel(prompt.at) }}</span>
            <span class="material-symbols-outlined text-[16px] text-dim" aria-hidden="true">{{ opened.has(index) ? "expand_less" : "expand_more" }}</span>
          </button>
          <p
            data-testid="prompt-text"
            class="mt-1 w-full select-text whitespace-pre-wrap break-words text-[12px] leading-[1.45]"
            :class="opened.has(index) ? '' : 'line-clamp-3 overflow-hidden'"
            @click="toggleUnlessSelecting(index)"
          >
            {{ prompt.text }}
          </p>
        </li>
      </ol>
      <!-- Says which end was cut, because the answer is not obvious from a list that is newest
           first: what is missing is the OLD prompts, not the ones just sent. -->
      <p v-if="truncated" class="px-4 py-2 text-center text-[11px] text-dim">Older prompts aren't shown.</p>
    </div>
  </section>
</template>
