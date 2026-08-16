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
import type { PromptEntry } from "../../common/promptHistory";
import { PROMPT_SUBMITTED_CHANNEL, isPromptSubmittedEvent } from "../../common/promptChannel";

const props = defineProps<{
  sessionId: string | null;
  cwd: string | null;
  agent: TerminalAgent;
  // Whether this pane currently covers the terminal area. Owned by the grid, shown here because
  // the button that flips it lives in this header — the same contract ToolsPane has.
  expanded?: boolean;
}>();
const emit = defineEmits<{ close: []; toggleExpand: [] }>();

const prompts = ref<PromptEntry[]>([]);
const truncated = ref(false);
const loading = ref(false);
const failed = ref(false);

// `text` is the row; without it there is nothing to draw. A missing or unreadable `at` is an
// ordinary case the row renders as a blank time, so it is normalised rather than rejected.
const readPrompt = (value: unknown): PromptEntry | null => {
  if (!isRecord(value) || typeof value.text !== "string" || !value.text) return null;
  return { at: typeof value.at === "number" ? value.at : null, text: value.text };
};

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
    const res = await fetchWithTimeout(`/api/transcript/prompts?${params.toString()}`);
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
const unsubscribe = subscribe(PROMPT_SUBMITTED_CHANNEL, (data: unknown) => {
  if (isPromptSubmittedEvent(data) && data.sessionId === props.sessionId) scheduleReload();
});

// One watch over the identity: the pane stays mounted while the grid walks the zoom from cell to
// cell, so a changed session/agent has to reload rather than keep another terminal's prompts.
watch([() => props.sessionId, () => props.agent, () => props.cwd], () => void load(true), { immediate: true });

onUnmounted(() => {
  window.clearTimeout(reloadTimer);
  unsubscribe();
});

// The time alone for today, with the date once it is older — "11:31" is enough to place a prompt
// from this morning, and useless for one from Tuesday.
const startOfToday = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
function formatTime(at: number | null): string {
  if (at === null) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at >= startOfToday() ? time : `${d.toLocaleDateString([], { month: "numeric", day: "numeric" })} ${time}`;
}

// Which rows are showing their full text. A long prompt is clamped so the list stays scannable,
// and clicking one opens it in place — the pane reads, and this is still reading.
const opened = ref(new Set<number>());
function toggle(index: number): void {
  const next = new Set(opened.value);
  if (!next.delete(index)) next.add(index);
  opened.value = next;
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
          :title="expanded ? 'Restore the terminal beside the prompts' : 'Expand the prompts over the terminal'"
          :aria-label="expanded ? 'Restore prompts pane width' : 'Expand prompts pane'"
          :aria-pressed="expanded === true"
          @click="emit('toggleExpand')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">{{ expanded ? "close_fullscreen" : "open_in_full" }}</span>
        </button>
        <button
          type="button"
          data-testid="prompts-close-btn"
          class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
          title="Close prompts pane"
          aria-label="Close prompts pane"
          @click="emit('close')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto font-sans text-[13px] text-fg">
      <p v-if="loading && prompts.length === 0" data-testid="prompts-empty" class="px-4 py-6 text-center text-[12px] text-dim">Loading…</p>
      <p v-else-if="failed" data-testid="prompts-empty" class="px-4 py-6 text-center text-[12px] text-dim">Couldn't read this session's prompts.</p>
      <p v-else-if="!sessionId" data-testid="prompts-empty" class="px-4 py-6 text-center text-[12px] text-dim">This cell hasn't started a session yet.</p>
      <p v-else-if="prompts.length === 0" data-testid="prompts-empty" class="px-4 py-6 text-center text-[12px] text-dim">Nothing sent to this session yet.</p>
      <ol v-else class="m-0 list-none p-0">
        <li v-for="(prompt, index) in newestFirst" :key="index" data-testid="prompt-row" class="border-b border-border last:border-b-0">
          <button
            type="button"
            class="flex w-full cursor-pointer flex-col items-start gap-1 border-0 bg-transparent px-3 py-2 text-left text-inherit hover:bg-subtle"
            :aria-expanded="opened.has(index)"
            :title="opened.has(index) ? 'Collapse' : 'Show the whole prompt'"
            @click="toggle(index)"
          >
            <span data-testid="prompt-time" class="text-[11px] tabular-nums text-dim">{{ formatTime(prompt.at) }}</span>
            <span
              data-testid="prompt-text"
              class="w-full whitespace-pre-wrap break-words text-[12px] leading-[1.45]"
              :class="opened.has(index) ? '' : 'line-clamp-3 overflow-hidden'"
              >{{ prompt.text }}</span
            >
          </button>
        </li>
      </ol>
      <!-- Says which end was cut, because the answer is not obvious from a list that is newest
           first: what is missing is the OLD prompts, not the ones just sent. -->
      <p v-if="truncated" class="px-4 py-2 text-center text-[11px] text-dim">Older prompts aren't shown.</p>
    </div>
  </section>
</template>
