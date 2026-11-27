<script setup lang="ts">
// The session's own conversation, read as turns rather than as the screen (#2112).
//
// A claude cell runs on the alternate screen, so the terminal holds no scrollback worth scrolling:
// what is above the fold is gone. This reads the agent's transcript instead — the same fold the
// phone gets (`server/session/transcript/transcript-view.ts`) — and pages BACKWARDS through it, so scrolling up
// walks the whole session to its first turn.
//
// A SNAPSHOT, deliberately: it does not follow a running turn. The terminal beside it is already the
// live view, and a pane that jumped while you were reading the part you scrolled back to find would
// be worse at the one job it has. The header carries a reload for when you want the newest again.
import { computed, nextTick, ref, watch } from "vue";
import MarkdownProse from "./MarkdownProse.vue";
import { groupTurnRows, toolBlockLabel, type TranscriptBlock } from "./transcriptBlocks";
import type { TranscriptRow, TranscriptRowKind, TranscriptTurn, TranscriptView } from "../../common/transcriptView";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { clockLabel } from "./clockLabel";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { transcriptPath } from "./remoteCell";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  sessionId: string | null;
  cwd: string | null;
  /** The cell's agent, for the LABEL on its frames and nothing else. Never used to choose a reader:
   *  the host asks each agent's log whether it holds this session, because a claude cell that
   *  outlived a restart reports itself as `shell` (server/session/transcript/transcript-view-read.ts). So a
   *  wrong answer here mislabels a frame; it cannot show the wrong conversation. */
  agent?: string | null;
  /** The remote host the session runs on (#3506), null or absent for this machine. */
  host?: string | null;
  // Whether this pane currently covers the terminal area. Owned by the grid, shown here because the
  // button that flips it lives in this header — the same contract Tools and Prompts have.
  expanded?: boolean;
  /** Shown as the body of another view (the Library's reader), which has its own title and room:
   *  no header row, no fixed width, no edge. */
  embedded?: boolean;
}>();
const emit = defineEmits<{ close: []; toggleExpand: [] }>();

/** How close to the top counts as "show me older". A page is fetched before the reader reaches the
 *  very top, so the turns are there by the time they would have run out. */
const LOAD_OLDER_WITHIN_PX = 240;

const turns = ref<TranscriptTurn[]>([]);
/** Null until a page has been read. A status other than `ok` is the whole answer — each one is a
 *  different sentence, which is why the server sends four rather than a boolean. */
const status = ref<TranscriptView["status"] | null>(null);
/** The cursor for the page before the oldest one held, or null at the head of what can be read. */
const older = ref<string | null>(null);
const loading = ref(false);
const loadingOlder = ref(false);
const failed = ref(false);
/** The non-`ok` status that ended the backward walk, or null when it ended at the head. */
const walkEndedBy = ref<TranscriptView["status"] | null>(null);
/** The walk stopped because a read FAILED, which is not a status the host sent and must not be
 *  reported as one: `loadOlder` gives up rather than retrying on every scroll event, and without
 *  this a dropped connection reads as "you have reached the beginning" (#2115). */
const olderFailed = ref(false);
const scroller = ref<HTMLElement | null>(null);

/** Which tool frames are open, keyed by the TURN OBJECT and the block's place inside it.
 *
 *  Collapsed by DEFAULT, which is the point: a turn's tool traffic is most of its bulk and almost
 *  none of what a reader came back for. The header still says what ran, so opening one is a
 *  decision rather than a search.
 *
 *  Keyed by the object rather than by the row's INDEX, because scrolling up is what adds turns
 *  above: an index key shifts under every prepend, so the first version cleared the whole set on
 *  any change to `turns` — which meant reading one tool frame and scrolling up to see the turn
 *  above it closed the frame you were reading, and the opening fill could do it five times over
 *  (Claude review, round 1). A turn object survives a prepend; only a reload replaces it, and that
 *  is where the map is cleared. */
const openTools = ref(new Map<TranscriptTurn, Set<number>>());
const toolsOpen = (turn: TranscriptTurn, block: number): boolean => openTools.value.get(turn)?.has(block) === true;
function toggleTools(turn: TranscriptTurn, block: number): void {
  const next = new Map(openTools.value);
  const blocks = new Set(next.get(turn) ?? []);
  if (!blocks.delete(block)) blocks.add(block);
  next.set(turn, blocks);
  openTools.value = next;
}

const isTranscriptRow = (value: unknown): value is TranscriptRow =>
  isRecord(value) &&
  typeof value.text === "string" &&
  (value.kind === "user" || value.kind === "assistant" || value.kind === "tool" || value.kind === "unknown");

// A turn with no readable row is dropped rather than rendered as an empty block. `at` is normalised
// instead: a turn is worth more than its clock, which is the same call the server makes.
const readTurn = (value: unknown): TranscriptTurn | null => {
  if (!isRecord(value) || !isUnknownArray(value.rows)) return null;
  const rows = value.rows.filter(isTranscriptRow);
  return rows.length === 0 ? null : { at: typeof value.at === "string" ? value.at : null, rows };
};

const readView = (body: unknown): { turns: TranscriptTurn[]; status: TranscriptView["status"]; older: string | null } | null => {
  if (!isRecord(body) || !isRecord(body.view) || typeof body.view.status !== "string") return null;
  const view = body.view;
  const rows = isUnknownArray(view.turns) ? view.turns.flatMap((turn) => readTurn(turn) ?? []) : [];
  const status = view.status;
  if (status !== "ok" && status !== "none" && status !== "cleared" && status !== "too-large" && status !== "not-supported") return null;
  return { turns: rows, status, older: typeof body.older === "string" ? body.older : null };
};

// Bumped per load, so a page for the cell you just walked away from cannot land in the one now
// enlarged — the same guard the prompts pane carries, and it matters more here: this pane appends.
let req = 0;

const url = (sessionId: string, before: string | null): string => {
  const params = new URLSearchParams({ session: sessionId });
  if (props.cwd) params.set("cwd", props.cwd);
  if (before !== null) params.set("before", before);
  return transcriptPath(props.host, "view", params);
};

/** The newest page and then enough older ones to fill the viewport — what "open this conversation"
 *  and "reload" both mean. Split from `load` because the fill has to run with `loading` already
 *  cleared: `loadOlder` declines while a newest-page read is in flight, and calling the fill from
 *  inside that read made it a no-op that still looked right in every test that did not measure a
 *  viewport. */
async function reload(): Promise<void> {
  await fillViewport(await load());
}

/** The newest page, replacing whatever is shown. Answers the request id it ran as, so whatever
 *  follows it can tell whether the pane has moved on to another cell since. */
async function load(): Promise<number> {
  const sessionId = props.sessionId;
  const my = ++req;
  turns.value = [];
  older.value = null;
  failed.value = false;
  status.value = null;
  openTools.value = new Map(); // the turns these keys name are being replaced
  walkEndedBy.value = null;
  olderFailed.value = false;
  // BOTH flags cleared HERE, not only where they are set: a read still in flight when the pane
  // follows the zoom to another cell fails its own `my === req` check and never reaches the
  // `finally` that would clear it. Left set, `loadingOlder` stops the new cell paging for good, and
  // `loading` leaves it saying "Loading…" over a cell with nothing to load, its reload disabled —
  // the trap the prompts pane documents, which this file half-fixed and then walked into again on
  // the sibling flag (Claude review, round 1).
  loadingOlder.value = false;
  loading.value = false;
  if (!sessionId) return my;
  loading.value = true;
  try {
    const res = await fetchWithTimeout(url(sessionId, null));
    if (!res.ok) throw new Error(String(res.status));
    const page = readView(await jsonBody(res));
    if (my !== req) return my; // superseded by a newer cell
    if (page === null) throw new Error("unreadable page");
    turns.value = page.turns;
    status.value = page.status;
    older.value = page.older;
    // The newest turn is at the BOTTOM, because the conversation reads downwards and that is where
    // a reader opening this pane expects to be — at the end of it, as the terminal would be.
    await nextTick();
    scrollToBottom();
  } catch {
    if (my === req) failed.value = true;
  } finally {
    if (my === req) loading.value = false;
  }
  return my;
}

/** The page before the oldest turn held, prepended. */
async function loadOlder(): Promise<void> {
  const sessionId = props.sessionId;
  const cursor = older.value;
  if (!sessionId || cursor === null || loadingOlder.value || loading.value) return;
  const my = req;
  loadingOlder.value = true;
  try {
    const res = await fetchWithTimeout(url(sessionId, cursor));
    if (!res.ok) throw new Error(String(res.status));
    const page = readView(await jsonBody(res));
    if (my !== req) return; // the pane moved to another cell while this was in flight
    if (page === null) throw new Error("unreadable page");
    // Every non-`ok` status ends the walk: there is nothing older to show, and the turns already on
    // screen are still the right thing to be showing. WHICH status ended it is kept, because "you
    // have reached the beginning" and "this host will not read further back" are different things to
    // tell a reader and the footer says one of them (Claude review, round 1).
    older.value = page.status === "ok" ? page.older : null;
    if (page.status !== "ok") walkEndedBy.value = page.status;
    if (page.turns.length > 0) await prepend(page.turns);
  } catch {
    if (my !== req) return;
    older.value = null; // stop asking rather than retry on every scroll event
    olderFailed.value = true; // ...and say that is why, rather than claiming the head was reached
  } finally {
    if (my === req) loadingOlder.value = false;
  }
}

/** Keep fetching older pages until there is a screenful to read, or the head is reached.
 *
 *  WITHOUT THIS THE PANE CAN OPEN ALMOST EMPTY, and it is not rare. A page is a LINE BUDGET over
 *  whole turns, and the budget evicts from the front — so a session whose newest turns are small
 *  (a prompt that was queued and never answered, a one-word "merge") gives a first page of those
 *  turns ALONE, with the turn that holds the actual work evicted just above it. Measured on this
 *  repo's own session: the newest page was a bare prompt and one short exchange, while the turn
 *  above it held hundreds of records. Nothing was lost — scrolling up reached it — but a reader who
 *  opens a conversation and sees one line does not go looking.
 *
 *  Bounded twice, because both bounds are reachable: a page count, so a session made entirely of
 *  tiny turns cannot walk itself to the head on open, and a "nothing came back" check, so a page
 *  that yields no turns ends the fill instead of spinning on the same cursor. */
const FILL_SCREENS = 1.5;
const MAX_FILL_PAGES = 5;
async function fillViewport(my: number): Promise<void> {
  for (let page = 0; page < MAX_FILL_PAGES; page++) {
    const el = scroller.value;
    // No layout to measure (a detached pane, jsdom) — fetching against a height of zero would run
    // the loop to its bound for no one.
    if (!el || el.clientHeight === 0 || older.value === null || my !== req) return;
    if (el.scrollHeight >= el.clientHeight * FILL_SCREENS) return;
    const had = turns.value.length;
    await loadOlder();
    if (my !== req || turns.value.length === had) return;
    await nextTick();
    // MEASURED AFTER THE PREPEND, never before the fetch. The reader can scroll during the round
    // trip — that IS the window this guard exists for — and a snapshot taken before it answers for
    // a moment that has passed, so it reads "they were at the end" and drags them back from
    // wherever they have got to (Codex, round 1). Measuring here needs no snapshot at all: `prepend`
    // has already carried their position, whatever it now is, across the DOM update.
    if (!atBottom(el)) return;
    scrollToBottom();
  }
}

/** How far from the end still counts as "at the end" — a sub-pixel gap, a rounded height. */
const AT_BOTTOM_SLACK_PX = 4;
const atBottom = (el: HTMLElement): boolean => el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_SLACK_PX;

/** Put older turns above, and keep the reader where they were.
 *
 *  WITHOUT THE CORRECTION THE FEATURE DOES NOT WORK: content added above the viewport pushes
 *  everything down, so every page jumps the reader away from the line they were reading — which is
 *  precisely the line that made them scroll back. The height DIFFERENCE is the correction, taken
 *  across the DOM update. */
async function prepend(older: TranscriptTurn[]): Promise<void> {
  const el = scroller.value;
  const before = el?.scrollHeight ?? 0;
  const top = el?.scrollTop ?? 0;
  turns.value = [...older, ...turns.value];
  await nextTick();
  if (!el) return;
  el.scrollTop = top + (el.scrollHeight - before);
}

function scrollToBottom(): void {
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function onScroll(): void {
  const el = scroller.value;
  if (!el || older.value === null) return;
  if (el.scrollTop <= LOAD_OLDER_WITHIN_PX) void loadOlder();
}

// One watch over the identity: the pane stays mounted while the grid walks the zoom from cell to
// cell, so a changed session has to reload rather than keep another terminal's conversation.
watch([() => props.sessionId, () => props.cwd, () => props.host], () => void reload(), { immediate: true });

/** What to say when there are no turns. Each status is its own sentence — "nothing here" and "this
 *  agent's conversation has no reader yet" send a reader to two different places. */
const emptyMessage = computed((): string => {
  if (failed.value) return t("transcriptPane.empty.failed");
  if (!props.sessionId) return t("transcriptPane.empty.notStarted");
  if (loading.value) return t("transcriptPane.empty.loading");
  switch (status.value) {
    case "cleared":
      return t("transcriptPane.empty.cleared");
    case "too-large":
      return t("transcriptPane.empty.tooLarge");
    case "not-supported":
      return t("transcriptPane.empty.notSupported");
    default:
      return t("transcriptPane.empty.none");
  }
});

/** The name on a frame. The agent's own name where the cell knows it — "You" and "Claude" reads as
 *  a conversation where "You" and "Agent" reads as a log. An `unknown` block says what it is
 *  instead: naming a speaker for a block nobody could read would be inventing one. */
const AGENT_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  copilot: "Copilot",
  grok: "Grok",
  muse: "Muse",
  antigravity: "Antigravity",
};
const agentName = computed((): string => AGENT_NAMES[props.agent ?? ""] ?? t("transcriptPane.speakers.agent"));
/** What the top of the pane says once there is nothing more to fetch. Reaching the beginning and
 *  being refused are not the same sentence: a transcript whose older pages exceed the host's ceiling
 *  answers `too-large`, and telling that reader they have reached the start is simply false. */
const headMessage = computed((): string => {
  if (olderFailed.value) return t("transcriptPane.head.failed");
  switch (walkEndedBy.value) {
    case "too-large":
      return t("transcriptPane.head.tooLarge");
    case "cleared":
      return t("transcriptPane.head.cleared");
    case null:
      return t("transcriptPane.head.start");
    default:
      return t("transcriptPane.head.none");
  }
});

const speaker = (kind: TranscriptRowKind): string => {
  if (kind === "assistant") return agentName.value;
  return (
    {
      user: t("transcriptPane.speakers.you"),
      tool: t("transcriptPane.speakers.tools"),
      unknown: t("transcriptPane.speakers.unreadable"),
    }[kind] ?? ""
  );
};

/** The frame a speaker's run is drawn in. Three looks, because three things are being distinguished:
 *  what YOU said (tinted, accent edge), what the agent said (a card), and what ran (no fill — it is
 *  collapsed by default and should not weigh as much as either). */
const FRAME_CLASSES: Record<TranscriptRowKind, string> = {
  user: "border-accent/40 bg-subtle",
  assistant: "border-border bg-panel",
  tool: "border-border bg-transparent",
  unknown: "border-border bg-transparent",
};
const frameClass = (kind: TranscriptRowKind): string => FRAME_CLASSES[kind];

/** A turn's rows as the frames to draw: one per run of the same speaker. */
const blocksOf = (rows: readonly TranscriptRow[]): TranscriptBlock[] => groupTurnRows(rows);

// An agent's reply goes through MarkdownProse: what it writes IS markdown — headings, tables, fenced
// code — and showing the characters instead of the document is what made the first cut of this pane
// hard to read. A PROMPT does not: it is what a person typed, and markdown would turn a line opening
// with `#` into a heading nobody asked for. It keeps its own line breaks instead.

const label = toolBlockLabel;
</script>

<template>
  <section class="flex h-full flex-col bg-deep" :class="embedded ? 'min-w-0 flex-1' : 'w-[340px] shrink-0 border-l border-border'">
    <div v-if="!embedded" class="flex items-center justify-between bg-panel px-4 py-2 font-sans text-[14px] text-fg">
      <div class="flex items-baseline gap-2">
        <span class="font-semibold">{{ t("transcriptPane.title") }}</span>
        <span v-if="loadingOlder" class="text-[11px] text-dim">{{ t("transcriptPane.loadingOlder") }}</span>
      </div>
      <!-- Reload, expand, close — expand and close in the order every other pane uses, since the
           three share one slot and the same control has to sit in the same place. -->
      <div class="flex items-center gap-1">
        <button
          type="button"
          data-testid="transcript-reload-btn"
          class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
          :data-tip="t('tips.panes.reloadConversation')"
          :aria-label="t('tips.panes.reloadConversationAria')"
          :disabled="loading"
          @click="void reload()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
        </button>
        <button
          type="button"
          data-testid="transcript-expand-btn"
          class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
          :data-tip="expanded ? t('tips.panes.conversation.restore') : t('tips.panes.conversation.expand')"
          :aria-label="expanded ? t('tips.panes.conversation.restoreAria') : t('tips.panes.conversation.expandAria')"
          :aria-pressed="expanded === true"
          @click="emit('toggleExpand')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">{{ expanded ? "close_fullscreen" : "open_in_full" }}</span>
        </button>
        <button
          type="button"
          data-testid="transcript-close-btn"
          class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
          :data-tip="t('tips.panes.conversation.close')"
          :aria-label="t('tips.panes.conversation.close')"
          @click="emit('close')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">right_panel_close</span>
        </button>
      </div>
    </div>
    <div ref="scroller" data-testid="transcript-scroll" class="flex-1 overflow-y-auto font-sans text-[13px] text-fg" @scroll="onScroll">
      <p v-if="turns.length === 0" data-testid="transcript-empty" class="px-4 py-6 text-center text-[12px] text-dim">{{ emptyMessage }}</p>
      <template v-else>
        <!-- Says which end is missing, and why it is not simply "scroll up": at the head of what can
             be read there is nothing more to fetch. -->
        <p v-if="older !== null" class="px-4 py-2 text-center text-[11px] text-dim">{{ t("transcriptPane.scrollOlder") }}</p>
        <p v-else data-testid="transcript-head" class="px-4 py-2 text-center text-[11px] text-dim">{{ headMessage }}</p>
        <ol class="m-0 list-none p-0">
          <li v-for="(turn, index) in turns" :key="index" data-testid="transcript-turn" class="px-3 py-2">
            <p v-if="clockLabel(turn.at)" data-testid="transcript-time" class="m-0 mb-1 text-[11px] tabular-nums text-dim">{{ clockLabel(turn.at) }}</p>
            <!-- ONE FRAME PER SPEAKER RUN, not per row: a turn alternates several times (you asked,
                 it answered, it ran three things, it answered again), and a frame per row is a
                 column of boxes with one line in each. -->
            <div
              v-for="(block, blockIndex) in blocksOf(turn.rows)"
              :key="blockIndex"
              data-testid="transcript-block"
              :data-kind="block.kind"
              class="mb-2 rounded-lg border px-3 py-2 last:mb-0"
              :class="frameClass(block.kind)"
            >
              <!-- A tool frame is a HEADER that opens: collapsed it says what ran, which is what a
                   reader wants from it nine times out of ten. -->
              <button
                v-if="block.kind === 'tool'"
                type="button"
                data-testid="transcript-tool-toggle"
                class="flex w-full cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-left text-[11px] text-dim hover:text-fg"
                :aria-expanded="toolsOpen(turn, blockIndex)"
                :data-tip="toolsOpen(turn, blockIndex) ? t('tips.panes.hideRan') : t('tips.panes.showRan')"
                @click="toggleTools(turn, blockIndex)"
              >
                <span class="material-symbols-outlined text-[16px]" aria-hidden="true">{{
                  toolsOpen(turn, blockIndex) ? "expand_more" : "chevron_right"
                }}</span>
                <span class="font-semibold">{{ speaker(block.kind) }}</span>
                <span data-testid="transcript-tool-label" class="min-w-0 flex-1 truncate">{{ label(block) }}</span>
              </button>
              <p v-else data-testid="transcript-speaker" class="m-0 mb-1 text-[11px] font-semibold" :class="block.kind === 'user' ? 'text-accent' : 'text-dim'">
                {{ speaker(block.kind) }}
              </p>
              <template v-if="block.kind !== 'tool' || toolsOpen(turn, blockIndex)">
                <template v-for="(row, rowIndex) in block.rows" :key="rowIndex">
                  <!-- Tool output is not prose: monospace, and it scrolls sideways rather than being
                       re-wrapped into something that no longer reads as the tool printed it. -->
                  <pre
                    v-if="block.kind === 'tool'"
                    data-testid="transcript-tool"
                    class="m-0 mt-1 overflow-x-auto whitespace-pre font-mono text-[11px] leading-[1.45] text-dim"
                    >{{ row.text }}</pre>
                  <!-- What a person typed, kept as they typed it. -->
                  <p
                    v-else-if="block.kind === 'user'"
                    data-testid="transcript-text"
                    class="m-0 select-text whitespace-pre-wrap break-words text-[13px] leading-[1.55]"
                  >
                    {{ row.text }}
                  </p>
                  <!-- The reply, as the markdown document it is: headings, lists, tables, fenced
                       code. MarkdownProse takes MARKDOWN, never HTML, so the sanitizer is not
                       something this template could route around. -->
                  <MarkdownProse v-else-if="block.kind === 'assistant'" data-testid="transcript-md" :markdown="row.text" class="text-[13px] leading-[1.6]" />
                  <p v-else data-testid="transcript-text" class="m-0 whitespace-pre-wrap break-words text-[12px] italic leading-[1.5] text-dim">
                    {{ row.text }}
                  </p>
                  <p v-if="row.clipped" :key="`clip-${rowIndex}`" class="m-0 text-[11px] text-dim">{{ t("transcriptPane.cutHere") }}</p>
                </template>
              </template>
            </div>
          </li>
        </ol>
      </template>
    </div>
  </section>
</template>
