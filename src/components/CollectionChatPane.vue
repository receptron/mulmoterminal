<script setup lang="ts">
// The terminal under an open collection (#2001).
//
// A chat started from a card used to appear as a grid cell, and placing it there brings the grid
// on screen — so the collection you were reading closed the moment you asked something about it.
// This pane claims that placement while it is mounted and runs the session HERE instead.
//
// It is a HOLDER, not an owner. A session has one live socket (a second attach supersedes the
// first, `server/session/pty-connection.ts`), so nothing here tries to share one with a cell:
// when the pane lets go — the overlay closes, or the user presses "Move to the grid" — it hands
// the same request to `placeSpawnedChat`, which is the path it would have taken anyway. Every
// session still ends up a grid cell; this only decides when.
import { computed, onBeforeUnmount, ref } from "vue";
import Terminal from "./Terminal.vue";
import { claimCollectionChat } from "../composables/collectionChatPane";
import { placeSpawnedChat, type SpawnedChatRequest } from "../composables/useSpawnedChat";
import { dragSplitter } from "../composables/dragSplitter";
import { clampPrimary, splitterKeySize, TERMINAL_COLLECTION } from "./splitterWidth";
import { BUILTIN_AGENT_OPTIONS } from "./agentPicker";

const HEIGHT_KEY = "mt-collection-chat-height";
const DEFAULT_HEIGHT = 320;

const held = ref<SpawnedChatRequest | null>(null);
// Bumped for each session this pane shows, which is what retargets the terminal slot — the same
// primitive a cell uses to re-attach (TerminalCell's `connectKey++`).
const connectKey = ref(0);

const stored = Number(localStorage.getItem(HEIGHT_KEY));
const height = ref(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_HEIGHT);
// The overlay fills the viewport below the 40px toolbar; the pane's floor and the collection's
// come from the shared geometry rules rather than from numbers invented here.
const available = (): number => window.innerHeight - 40;
const setHeight = (next: number): void => {
  height.value = clampPrimary(next, available(), TERMINAL_COLLECTION);
  localStorage.setItem(HEIGHT_KEY, String(height.value));
};

/** Hand what is held to the grid, where it would have gone without this pane. */
function release(): void {
  const request = held.value;
  held.value = null;
  if (request) placeSpawnedChat(request);
}

// One at a time: a second chat started while the first is still here pushes the first to the grid
// rather than replacing it silently — a live agent must not lose the only screen it is on.
const stopClaiming = claimCollectionChat((req) => {
  release();
  held.value = req;
  connectKey.value += 1;
  return true;
});

onBeforeUnmount(() => {
  stopClaiming();
  release(); // the overlay is closing — the session goes back to being an ordinary cell
});

// The picker's own words for the agent, so the pane names it the way the dropdown above it does.
const label = computed(() => BUILTIN_AGENT_OPTIONS.find((option) => option.agent === held.value?.agent)?.label ?? "Chat");

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
    <div class="flex flex-none items-center gap-2 border-b border-border px-3 py-1 font-sans text-[12px] text-dim">
      <span class="material-symbols-outlined text-[15px] leading-none" aria-hidden="true">terminal</span>
      <span>{{ label }}</span>
      <!-- One button, not a close: the session is live, so "closing" it here can only mean sending
           it where it lives — the grid. Saying that is better than an X that silently moves it. -->
      <button
        type="button"
        class="ml-auto cursor-pointer rounded border border-border bg-transparent px-2 py-0.5 text-[12px] text-fg hover:bg-hover"
        title="Move this session to the grid and close the pane"
        @click="release"
      >
        Move to the grid
      </button>
    </div>
    <div class="min-h-0 flex-1">
      <Terminal :session-id="held.id" :connect-key="connectKey" :agent="held.agent" hide-header />
    </div>
  </div>
</template>
