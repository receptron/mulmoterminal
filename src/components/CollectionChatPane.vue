<script setup lang="ts">
// The terminal under an open collection (#2001).
//
// A chat started from a card used to appear as a grid cell, and placing it there brings the grid on
// screen — so the collection you were reading closed the moment you asked something about it. This
// pane claims that placement while it is mounted and runs the session HERE instead.
//
// What it shows is THIS COLLECTION's session (collectionChatSessions.ts), not "whatever was started
// last": switching to another collection switches the pane with it, and coming back — from another
// collection, or from the grid — brings the same terminal back, scrollback and all. The socket and
// the xterm survive because the slot is durable (`persistKey`), keyed by the session.
//
// The session stays filed under its collection until it is deliberately moved: "Move to the grid"
// makes it an ordinary cell, and an exit clears it. Closing the overlay does neither — that is
// what made it impossible to come back to.
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import Terminal from "./Terminal.vue";
import { claimCollectionChat } from "../composables/collectionChatPane";
import {
  activateCollectionChat,
  collectionChatKey,
  collectionChatSlotKey,
  collectionChatsFor,
  dropCollectionChat,
  holdCollectionChat,
} from "../composables/collectionChatSessions";
import { useCollectionBrowse, browseRouteProjectId } from "../composables/useCollectionBrowse";
import { placeSpawnedChat, type SpawnedChatRequest } from "../composables/useSpawnedChat";
import { release } from "../composables/useTerminalConnections";
import { dragSplitter } from "../composables/dragSplitter";
import { clampPrimary, maxPrimary, MIN_TERMINAL_HEIGHT, splitterKeySize, TERMINAL_COLLECTION } from "./splitterWidth";
import { BUILTIN_AGENT_OPTIONS } from "./agentPicker";
import { useGridActivity } from "../composables/useGridActivity";
import { useSessionSummary } from "../composables/useSessionSummary";
import { activityStatus, type AttentionStatus } from "./attentionStatus";

const HEIGHT_KEY = "mt-collection-chat-height";
const DEFAULT_HEIGHT = 320;

const { view } = useCollectionBrowse();
const key = computed(() => collectionChatKey(view.value, browseRouteProjectId()));
const chats = computed(() => collectionChatsFor(key.value));
const held = computed(() => chats.value.sessions.find((session) => session.id === chats.value.activeId) ?? null);

// The supervision the grid gives a cell, for a tab: whose turn it is, and what the agent is doing.
// Read from the SAME sources the cockpit roster reads — attention from the session activity stream
// (keyed by session id, so it covers a session no cell holds), the summary from the transcript
// endpoint. A chat that runs here rather than in the grid was invisible to every read-out the app
// has; these two are what make a tab worth glancing at (#2001).
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

const stored = Number(localStorage.getItem(HEIGHT_KEY));
const height = ref(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_HEIGHT);
/** The toolbar above the overlay, which the viewport height has to be read net of. */
const TOOLBAR_HEIGHT = 40;
// Tracked rather than read on demand because the separator PUBLISHES its range (aria-valuemax), so
// the bounds have to be a value the template can re-render from, not only one a handler can ask for.
const viewportHeight = ref(window.innerHeight);
const onViewportResize = (): void => {
  viewportHeight.value = window.innerHeight;
  // The stored height was clamped against the viewport it was set in. On a shorter one it is out
  // of range — the pane eats the collection, and the separator publishes a position past its own
  // maximum (Codex, PR #2002).
  setHeight(height.value);
};
window.addEventListener("resize", onViewportResize);
onBeforeUnmount(() => window.removeEventListener("resize", onViewportResize));
// The overlay fills the viewport below the toolbar; the pane's floor and the collection's come
// from the shared geometry rules rather than from numbers invented here.
const available = computed(() => viewportHeight.value - TOOLBAR_HEIGHT);
const heightMax = computed(() => maxPrimary(available.value, TERMINAL_COLLECTION));
const setHeight = (next: number): void => {
  height.value = clampPrimary(next, available.value, TERMINAL_COLLECTION);
  localStorage.setItem(HEIGHT_KEY, String(height.value));
};
setHeight(height.value); // what was restored was clamped against another viewport, not this one

/** Stop showing `req` here and tear its slot down. The caller decides where it goes instead. */
function unfile(target: string, req: SpawnedChatRequest): void {
  dropCollectionChat(target, req.id);
  release(collectionChatSlotKey(req.id));
}

// A chat started while a collection is open is filed under THAT collection, as another tab. The one
// already running keeps its tab and its terminal — asking a second thing while the first is working
// is the ordinary case, and the first version paid for it by pushing that one to the grid.
const stopClaiming = claimCollectionChat((req) => {
  const target = key.value;
  if (!target) return false; // nothing open to file it under — the grid path takes it
  holdCollectionChat(target, req);
  return true;
});

onBeforeUnmount(stopClaiming); // the sessions stay filed — that is what makes coming back work

/** Bring one of this collection's chats to the front. */
function show(id: string): void {
  if (key.value) activateCollectionChat(key.value, id);
}

// `role="tab"` is a promise about the keyboard, not just a label: arrows move between tabs, Home
// and End reach the ends, and only the selected tab is in the tab order so Tab leaves the strip
// rather than walking it (Codex, PR #2002). Focus follows selection, which is the pattern's
// automatic-activation form — right here, where selecting is switching a terminal that is already
// running rather than loading something.
const tabRefs = ref<HTMLElement[]>([]);
const KEY_STEPS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
function onTabKey(e: KeyboardEvent, index: number): void {
  const last = chats.value.sessions.length - 1;
  const step = KEY_STEPS[e.key];
  let next = index;
  if (step !== undefined) next = (index + step + last + 1) % (last + 1);
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = last;
  else return;
  e.preventDefault();
  const target = chats.value.sessions[next];
  if (!target) return;
  show(target.id);
  void nextTick(() => tabRefs.value[next]?.focus());
}

/** Hand the chat you are looking at to the grid, where it becomes an ordinary cell. */
function moveToGrid(): void {
  const target = key.value;
  const req = held.value;
  if (!target || !req) return;
  unfile(target, req);
  placeSpawnedChat(req);
}

/** The agent ended. Nothing to show and nothing to move — just stop offering it. */
function onExit(): void {
  const target = key.value;
  const req = held.value;
  if (target && req) unfile(target, req);
}

// The picker's own words for the agent, so a tab names it the way the dropdown above it does. The
// ordinal is what tells two of the same agent apart at a glance; the session id is in the tooltip,
// where it is available to quote without being read every time.
const agentLabel = (agent: string): string => BUILTIN_AGENT_OPTIONS.find((option) => option.agent === agent)?.label ?? "Chat";
const tabLabel = (req: SpawnedChatRequest, index: number): string =>
  chats.value.sessions.filter((session) => session.agent === req.agent).length > 1 ? `${agentLabel(req.agent)} ${index + 1}` : agentLabel(req.agent);
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

// Dragging UP grows the terminal: it lies AFTER its separator.
const onSplitterDown = dragSplitter({
  axis: (e) => e.clientY,
  size: () => height.value,
  resize: (start, travel) => setHeight(start - travel),
  key: HEIGHT_KEY,
  remember: (key, value) => localStorage.setItem(key, value),
});

function onSplitterKey(e: KeyboardEvent): void {
  const next = splitterKeySize(e.key, height.value, available.value, TERMINAL_COLLECTION, "vertical", "after");
  if (next === null) return;
  e.preventDefault();
  setHeight(next);
}
</script>

<template>
  <div v-if="held" class="flex flex-none flex-col border-t border-border" :style="{ height: `${height}px` }">
    <div
      class="h-1.5 flex-none cursor-row-resize bg-border/40 hover:bg-accent"
      role="separator"
      aria-orientation="horizontal"
      :aria-label="`Resize the ${label} pane`"
      :aria-valuenow="height"
      :aria-valuemin="MIN_TERMINAL_HEIGHT"
      :aria-valuemax="heightMax"
      tabindex="0"
      @pointerdown="onSplitterDown"
      @keydown="onSplitterKey"
    />
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
        ref="tabRefs"
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
        {{ tabLabel(session, index) }}
      </button>
      <!-- Acts on the tab you are looking at. Not a close: the session is live, so "closing" it here
           can only mean sending it where it lives — the grid. Leaving the collection is NOT closing;
           the tabs stay filed and come back. -->
      <button
        type="button"
        class="ml-auto flex-none cursor-pointer rounded border border-border bg-transparent px-2 py-0.5 text-[12px] text-fg hover:bg-hover"
        :title="`Move this ${label} session to the grid and close its tab`"
        @click="moveToGrid"
      >
        Move to the grid
      </button>
    </div>
    <!-- What this agent is doing, in the words the cockpit roster uses. Without it a tab says only
         that something is running, which is the half a terminal in the grid never had to say. -->
    <div v-if="summaryLine" class="flex-none truncate border-b border-border px-3 py-1 font-sans text-[12px] text-muted" :title="summaryLine">
      {{ summaryLine }}
    </div>
    <div :id="PANEL_ID" role="tabpanel" :aria-labelledby="tabId(held.id)" class="min-h-0 flex-1">
      <!-- Keyed by the session so switching collections switches terminals; the durable slot of the
           same name is what each one comes back to. -->
      <Terminal
        :key="held.id"
        :session-id="held.id"
        :connect-key="0"
        :agent="held.agent"
        :persist-key="collectionChatSlotKey(held.id)"
        hide-header
        @exit="onExit"
      />
    </div>
  </div>
</template>
