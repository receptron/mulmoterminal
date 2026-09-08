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
import { computed, onBeforeUnmount, ref } from "vue";
import Terminal from "./Terminal.vue";
import { claimCollectionChat } from "../composables/collectionChatPane";
import { activateCollectionChat, collectionChatKey, collectionChatsFor, dropCollectionChat, holdCollectionChat } from "../composables/collectionChatSessions";
import { useCollectionBrowse, browseRouteProjectId } from "../composables/useCollectionBrowse";
import { placeSpawnedChat, type SpawnedChatRequest } from "../composables/useSpawnedChat";
import { release } from "../composables/useTerminalConnections";
import { dragSplitter } from "../composables/dragSplitter";
import { clampPrimary, splitterKeySize, TERMINAL_COLLECTION } from "./splitterWidth";
import { BUILTIN_AGENT_OPTIONS } from "./agentPicker";

const HEIGHT_KEY = "mt-collection-chat-height";
const DEFAULT_HEIGHT = 320;
// One durable slot per session: the same session shown again reuses it, so returning to a
// collection is the terminal you left rather than a reconnect that redraws.
const slotKey = (id: string): string => `collection-chat-${id}`;

const { view } = useCollectionBrowse();
const key = computed(() => collectionChatKey(view.value, browseRouteProjectId()));
const chats = computed(() => collectionChatsFor(key.value));
const held = computed(() => chats.value.sessions.find((session) => session.id === chats.value.activeId) ?? null);

const stored = Number(localStorage.getItem(HEIGHT_KEY));
const height = ref(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_HEIGHT);
// The overlay fills the viewport below the 40px toolbar; the pane's floor and the collection's come
// from the shared geometry rules rather than from numbers invented here.
const available = (): number => window.innerHeight - 40;
const setHeight = (next: number): void => {
  height.value = clampPrimary(next, available(), TERMINAL_COLLECTION);
  localStorage.setItem(HEIGHT_KEY, String(height.value));
};

/** Stop showing `req` here and tear its slot down. The caller decides where it goes instead. */
function unfile(target: string, req: SpawnedChatRequest): void {
  dropCollectionChat(target, req.id);
  release(slotKey(req.id));
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

// Dragging UP grows the terminal: it lies AFTER its separator.
const onSplitterDown = dragSplitter({
  axis: (e) => e.clientY,
  size: () => height.value,
  resize: (start, travel) => setHeight(start - travel),
  key: HEIGHT_KEY,
  remember: (key, value) => localStorage.setItem(key, value),
});

function onSplitterKey(e: KeyboardEvent): void {
  const next = splitterKeySize(e.key, height.value, available(), TERMINAL_COLLECTION, "vertical", "after");
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
        :key="session.id"
        type="button"
        role="tab"
        :aria-selected="session.id === chats.activeId"
        :title="`${agentLabel(session.agent)} — session ${session.id}`"
        class="flex cursor-pointer items-center gap-1 rounded border-0 px-2 py-0.5 text-[12px]"
        :class="session.id === chats.activeId ? 'bg-selected text-fg' : 'bg-transparent text-dim hover:text-fg'"
        @click="show(session.id)"
      >
        <span class="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">terminal</span>
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
    <div class="min-h-0 flex-1">
      <!-- Keyed by the session so switching collections switches terminals; the durable slot of the
           same name is what each one comes back to. -->
      <Terminal :key="held.id" :session-id="held.id" :connect-key="0" :agent="held.agent" :persist-key="slotKey(held.id)" hide-header @exit="onExit" />
    </div>
  </div>
</template>
