<script setup lang="ts">
// The terminal under an open collection (#2001).
//
// A chat started from a card used to appear as a grid cell, and placing it there brings the grid on
// screen — so the collection you were reading closed the moment you asked something about it. It is
// still an ordinary grid cell; what changed is that starting one no longer takes the screen, and
// that the cell can be worked from HERE while the collection is open.
//
// This pane owns NO terminal. It is a receptacle: it claims one session and the grid TELEPORTS that
// session's cell into it (`collectionTerminalClaim.ts`). One component, one socket, one xterm, one
// scrollback — the same mechanism the zoomed cell uses. So the same chat is operated from the grid
// or from here depending only on which view is open, with no hand-off button and no reconnect.
//
// What it shows is THIS COLLECTION's chats (collectionChatSessions.ts), not "whatever was started
// last": switching to another collection switches the strip with it, and the cells of the one you
// left keep running in the grid.
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { activateCollectionChat, collectionChatsFor } from "../composables/collectionChatSessions";
import { claimCollectionTerminal, releaseCollectionTerminal } from "../composables/collectionTerminalClaim";
import { currentCollectionChatKey } from "../composables/useCollectionBrowse";
import type { SpawnedChatRequest } from "../composables/useSpawnedChat";
import { dragSplitter } from "../composables/dragSplitter";
import { clampPrimary, maxPrimary, splitterKeySize, TERMINAL_COLLECTION, TERMINAL_COLLECTION_SIDE } from "./splitterWidth";
import { collectionChatDock, toggleCollectionChatDock } from "../composables/collectionChatDock";
import { BUILTIN_AGENT_OPTIONS } from "./agentPicker";
import { useGridActivity } from "../composables/useGridActivity";
import { useSessionSummary } from "../composables/useSessionSummary";
import { activityStatus, type AttentionStatus } from "./attentionStatus";

// One size per DOCK, not one shared number: a good height under the collection is not a good width
// beside it, so switching would otherwise re-clamp whatever you had set into the other axis' range.
const HEIGHT_KEY = "mt-collection-chat-height";
const WIDTH_KEY = "mt-collection-chat-width";
const DEFAULT_HEIGHT = 320;
const DEFAULT_WIDTH = 420;

// The collection on screen, as the filing key — the same answer `startCollectionChat` captures
// when a chat begins, so the pane looks under exactly where the launcher filed it.
const key = computed(currentCollectionChatKey);
const chats = computed(() => collectionChatsFor(key.value));
const held = computed(() => chats.value.sessions.find((session) => session.id === chats.value.activeId) ?? null);

// The supervision a grid cell wears, for a TAB: whose turn it is, and what the agent is doing.
// Read from the SAME sources the cockpit roster reads — attention from the session activity stream,
// the summary from the transcript endpoint — so the two never disagree. A tab is one line of chrome
// with no cell header to read, and the other chats here are off-screen entirely; without these it
// says only that something exists (#2001).
const sessionIds = computed(() => chats.value.sessions.map((session) => session.id));
const { activity } = useGridActivity(sessionIds);
const statusOf = (id: string): AttentionStatus => {
  const live = activity.get(id);
  return live ? activityStatus(live.working, live.waiting, live.event) : "idle";
};
const summary = useSessionSummary(computed(() => held.value?.id ?? null));

// A session that ends while its terminal is NOT mounted is dropped by the filing itself, which
// listens for the server's own "closed" push — see collectionChatSessions.ts. Not here: the case
// it covers is mostly a session that ends while this pane is not on screen at all.

const storedSize = (key: string, fallback: number): number => {
  const raw = Number(localStorage.getItem(key));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};
const height = ref(storedSize(HEIGHT_KEY, DEFAULT_HEIGHT));
const width = ref(storedSize(WIDTH_KEY, DEFAULT_WIDTH));
/** The toolbar above the overlay, which the viewport height has to be read net of. */
const TOOLBAR_HEIGHT = 40;
// Tracked rather than read on demand because the separator PUBLISHES its range (aria-valuemax), so
// the bounds have to be a value the template can re-render from, not only one a handler can ask for.
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
// One splitter, read along whichever axis the pane is docked on. The rule, the floors and the clamp
// are the shared ones (splitterWidth.ts); all that changes is which number they are about.
const dockedRight = computed(() => collectionChatDock.value === "right");
const size = computed(() => (dockedRight.value ? width.value : height.value));
const floors = computed(() => (dockedRight.value ? TERMINAL_COLLECTION_SIDE : TERMINAL_COLLECTION));
const sizeKey = computed(() => (dockedRight.value ? WIDTH_KEY : HEIGHT_KEY));
// Docked right the pane spans the whole width; docked under it, the overlay fills what the toolbar
// leaves. The pane's floor and the collection's come from the shared geometry rather than from
// numbers invented here.
const available = computed(() => (dockedRight.value ? viewport.value.width : viewport.value.height - TOOLBAR_HEIGHT));
const sizeMax = computed(() => maxPrimary(available.value, floors.value));
const setSize = (next: number): void => {
  const clamped = clampPrimary(next, available.value, floors.value);
  if (dockedRight.value) width.value = clamped;
  else height.value = clamped;
  localStorage.setItem(sizeKey.value, String(clamped));
};
const onViewportResize = (): void => {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
  // The stored size was clamped against the viewport it was set in. On a smaller one it is out of
  // range — the pane eats the collection, and the separator publishes a position past its own
  // maximum (Codex, PR #2002).
  setSize(size.value);
};
window.addEventListener("resize", onViewportResize);
onBeforeUnmount(() => window.removeEventListener("resize", onViewportResize));
// Immediate: what was restored was clamped against another viewport. And on every switch after
// that, because the size being switched TO was last clamped against the other axis entirely.
watch(collectionChatDock, () => setSize(size.value), { immediate: true });

// The receptacle the grid teleports the shown chat's cell into. Claimed by SESSION rather than by
// cell uid: uids are positional and are renumbered whenever the grid is re-parsed, so a number held
// here would eventually name a different terminal.
const slot = ref<HTMLElement | null>(null);
let claimed: string | null = null;

function claimShown(): void {
  const id = held.value?.id ?? null;
  if (claimed === id && (!id || slot.value)) return;
  if (claimed) releaseCollectionTerminal(claimed);
  claimed = id;
  if (id && slot.value) claimCollectionTerminal(id, slot.value);
}

// The element arrives with the v-if, so both the shown session AND the receptacle are watched. Post
// flush: the claim hands the grid a DOM node to teleport into, which has to exist first.
watch([held, slot], claimShown, { flush: "post" });

// Give the cell back to the grid — this is what puts the terminal back in its tile when the overlay
// closes, and it must run even though the session goes on running.
onBeforeUnmount(() => {
  if (claimed) releaseCollectionTerminal(claimed);
  claimed = null;
});

/** Bring one of this collection's chats to the front — which moves the teleport with it. */
function show(id: string): void {
  if (key.value) activateCollectionChat(key.value, id);
}

// `role="tab"` is a promise about the keyboard, not just a label: arrows move between tabs, Home
// and End reach the ends, and only the selected tab is in the tab order so Tab leaves the strip
// rather than walking it (Codex, PR #2002). Focus follows selection, which is the pattern's
// automatic-activation form — right here, where selecting only moves a terminal that is already
// running and on screen somewhere.
const KEY_STEPS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
/** The tab a key moves to, or null when the key is not ours — the handler must not preventDefault
 *  then, or the strip would swallow Tab and Escape while focused. */
function nextTabIndex(key: string, index: number, count: number): number | null {
  const step = KEY_STEPS[key];
  if (step !== undefined) return (index + step + count) % count;
  if (key === "Home") return 0;
  return key === "End" ? count - 1 : null;
}

function onTabKey(e: KeyboardEvent, index: number): void {
  const next = nextTabIndex(e.key, index, chats.value.sessions.length);
  if (next === null) return;
  e.preventDefault();
  const target = chats.value.sessions[next];
  if (!target) return;
  show(target.id);
  // By id, not by the ref array's position: Vue does not promise that `v-for` template refs are
  // collected in source order, so an index can select one session and focus another tab
  // (CodeRabbit, PR #2002).
  void nextTick(() => document.getElementById(tabId(target.id))?.focus());
}

// The picker's own words for the agent, so a tab names it the way the dropdown above it does. The
// ordinal is what tells two of the same agent apart at a glance; the session id is in the tooltip,
// where it is available to quote without being read every time.
const agentLabel = (agent: string): string => BUILTIN_AGENT_OPTIONS.find((option) => option.agent === agent)?.label ?? "Chat";
const tabLabel = (req: SpawnedChatRequest): string => {
  // Numbered among its OWN kind, not by position in the strip: `Claude, Codex, Claude` reads as
  // "Claude 1 / Codex / Claude 2", and the strip's index would have called the last one Claude 3
  // (Codex, PR #2002).
  const sameAgent = chats.value.sessions.filter((session) => session.agent === req.agent);
  if (sameAgent.length < 2) return agentLabel(req.agent);
  return `${agentLabel(req.agent)} ${sameAgent.findIndex((session) => session.id === req.id) + 1}`;
};
const label = computed(() => (held.value ? agentLabel(held.value.agent) : "Chat"));

// The terminal the strip controls. One panel, not one per tab: only the selected chat is mounted,
// so there is one thing for every tab to point at — and it names the tab whose chat it is showing,
// which is the half that says WHICH of them you are looking at (Codex, PR #2002).
const PANEL_ID = "collection-chat-panel";
const tabId = (id: string): string => `collection-chat-tab-${id}`;
// The grid's own vocabulary for a status, so the pane does not invent a second one.
const STATUS_DOT: Record<AttentionStatus, string> = {
  blocked: "bg-amber",
  done: "bg-ok",
  working: "bg-muted",
  idle: "bg-border",
};
const STATUS_WORD: Record<AttentionStatus, string> = {
  blocked: "waiting on you",
  done: "finished, unreviewed",
  working: "working",
  idle: "idle",
};
// The roster shows summary / prompt / reply on three lines; one line is what fits here, so it is
// the most specific thing available: what the agent is doing, else what it was asked.
const summaryLine = computed(() => summary.value.aiTitle ?? summary.value.lastPrompt ?? null);

// Dragging toward the start grows the terminal: it lies AFTER its separator, on either dock.
const onSplitterDown = dragSplitter({
  axis: (e) => (dockedRight.value ? e.clientX : e.clientY),
  size: () => size.value,
  resize: (start, travel) => setSize(start - travel),
  // Read at the END of a drag, and the dock cannot change during one — so the two keys share a
  // splitter instead of the pane carrying two of everything.
  get key() {
    return sizeKey.value;
  },
  remember: (key, value) => localStorage.setItem(key, value),
});

function onSplitterKey(e: KeyboardEvent): void {
  // Docked right the bar is VERTICAL, and a vertical separator is driven by Left/Right — the axis
  // argument names the keys rather than the bar (splitterWidth.ts).
  const axis = dockedRight.value ? "horizontal" : "vertical";
  const next = splitterKeySize(e.key, size.value, available.value, floors.value, axis, "after");
  if (next === null) return;
  e.preventDefault();
  setSize(next);
}

// The button says what pressing it DOES, because a toggle showing the state it is already in is
// the one thing nobody can read from an icon.
const dockAction = computed(() => (dockedRight.value ? "Move the chat under the collection" : "Move the chat beside the collection"));
</script>

<template>
  <!-- Under the collection or beside it, chosen by the button in the strip. The two are the same
       pane read along a different axis: the separator is the leading edge either way, so the border,
       the cursor and the direction all follow the dock rather than being written twice. -->
  <div
    v-if="held"
    class="flex flex-none"
    :class="dockedRight ? 'flex-row border-l border-border' : 'flex-col border-t border-border'"
    :style="dockedRight ? { width: `${size}px` } : { height: `${size}px` }"
  >
    <div
      class="flex-none bg-border/40 hover:bg-accent"
      :class="dockedRight ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'"
      role="separator"
      :aria-orientation="dockedRight ? 'vertical' : 'horizontal'"
      :aria-label="`Resize the ${label} pane`"
      :aria-valuenow="size"
      :aria-valuemin="floors.primary"
      :aria-valuemax="sizeMax"
      tabindex="0"
      @pointerdown="onSplitterDown"
      @keydown="onSplitterKey"
    />
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        class="flex flex-none items-center gap-1 border-b border-border px-2 py-1 font-sans text-[12px] text-dim"
        role="tablist"
        aria-label="Chats in this collection"
      >
        <!-- One tab per chat this collection holds. Each keeps its own terminal alive, so switching
             is the terminal you left rather than a reconnect. -->
        <button
          v-for="(session, index) in chats.sessions"
          :id="tabId(session.id)"
          :key="session.id"
          type="button"
          role="tab"
          :aria-selected="session.id === chats.activeId"
          :aria-controls="PANEL_ID"
          :tabindex="session.id === chats.activeId ? 0 : -1"
          :title="`${agentLabel(session.agent)} — ${STATUS_WORD[statusOf(session.id)]} — session ${session.id}`"
          class="flex cursor-pointer items-center gap-1 rounded border-0 px-2 py-0.5 text-[12px]"
          :class="session.id === chats.activeId ? 'bg-selected text-fg' : 'bg-transparent text-dim hover:text-fg'"
          @click="show(session.id)"
          @keydown="onTabKey($event, index)"
        >
          <!-- Whose turn it is, in the grid's own colours. The word is in the title rather than
               beside it: the strip has to stay narrow enough for several tabs. -->
          <span class="h-2 w-2 flex-none rounded-full" :class="STATUS_DOT[statusOf(session.id)]" aria-hidden="true" />
          {{ tabLabel(session) }}
        </button>
        <!-- Outside the tablist's roles: it moves the whole pane, not the chat the tabs select. -->
        <button
          type="button"
          class="ml-auto flex flex-none cursor-pointer items-center justify-center rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
          :aria-label="dockAction"
          :title="dockAction"
          @click="toggleCollectionChatDock"
        >
          <span class="material-symbols-outlined" aria-hidden="true">{{ dockedRight ? "dock_to_bottom" : "dock_to_right" }}</span>
        </button>
        <!-- No "move to the grid": it is ALREADY a grid cell. Closing it is the cell's own business,
             in the grid, where closing a terminal has always lived. -->
      </div>
      <!-- What this agent is doing, in the words the cockpit roster uses. Without it a tab says only
           that something is running, which is the half a terminal in the grid never had to say. -->
      <div v-if="summaryLine" class="flex-none truncate border-b border-border px-3 py-1 font-sans text-[12px] text-muted" :title="summaryLine">
        {{ summaryLine }}
      </div>
      <!-- Empty on purpose: the grid teleports this chat's own cell in here, so nothing this
           component renders is remounted when the view changes.
           The child rules are the receptacle's whole job. A cell is given its size by whatever holds
           it — the CSS grid in a tile, `.zoom-main > *` when enlarged — and a teleported cell that is
           told nothing grows to its CONTENT instead: the terminal ran past the bottom of the window,
           taking the input line with it (reported in use). Same three properties `.zoom-main` gives
           its own child, as utilities. -->
      <div :id="PANEL_ID" ref="slot" role="tabpanel" :aria-labelledby="tabId(held.id)" class="flex min-h-0 flex-1 [&>*]:min-h-0 [&>*]:min-w-0 [&>*]:flex-1" />
    </div>
  </div>
</template>
