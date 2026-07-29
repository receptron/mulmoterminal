<script setup lang="ts">
// The expand/restore and close buttons every grid cell's header ends with — identical in
// the command, launcher and terminal cells, down to the labels and the glyphs, because they
// mean the same thing to the grid: one zooms this cell, the other retires it (#646 B3).
//
// What "close" DOES stays with the parent: TerminalCell's may hold a live session, so its
// handler confirms before tearing down. This emits the intent and never acts on it, so a
// cell can't lose its confirmation by adopting the shared buttons (#826).
//
// No `.stop` on the clicks: the enclosing header's zoom gesture already ignores anything
// inside a button (shouldZoomOnHeaderClick), and stopping here would only hide that.
import { computed } from "vue";
import { CELL_BTN, CELL_BTN_ACTIVE, CELL_BTN_DISABLEABLE, CELL_CLOSE_BTN } from "./cellChromeClasses";

const props = defineProps<{
  expanded: boolean;
  filesOpen?: boolean;
  // Which side pane this cell is showing, so each button can read as pressed. The three share
  // one slot beside the enlarged terminal, so at most one is ever pressed.
  rightPane?: "files" | "canvas" | "tools" | null | undefined;
  // Whether this cell's session actually has the drawing tools — i.e. whether its directory has
  // the `render` MCP group registered with Claude Code. False disables the button rather than
  // removing it: the pane would open empty, and that is worth SAYING rather than hiding.
  canvasAvailable?: boolean;
}>();
const emit = defineEmits<{ (e: "toggle-expand" | "close" | "toggle-files" | "toggle-canvas" | "toggle-tools"): void }>();

// The unavailable case names the fix, not just the state: the registration is per directory and
// only read when a session starts, so it takes a restart even once switched on.
const canvasTitle = computed(() => {
  if (!props.canvasAvailable) return "No render MCP for this directory — turn on Canvas in the launcher, then restart this cell";
  return props.rightPane === "canvas" ? "Hide canvas" : "Show canvas";
});

// Pressed buttons get a DIFFERENT class string, not an extra one: the two carry competing `bg-*`
// utilities, and appending would leave which of them wins to Tailwind's output order.
//
// Which pane is open was only in `aria-pressed` and the tooltip before — true for a screen reader
// and for whoever hovers, invisible to everyone looking at the header.
const filesClass = computed(() => (props.filesOpen ? CELL_BTN_ACTIVE : CELL_BTN));
// A disabled Canvas cannot be the open pane, so the pressed style never has to survive `disabled:`.
const canvasClass = computed(() => (props.rightPane === "canvas" ? CELL_BTN_ACTIVE : CELL_BTN_DISABLEABLE));
const toolsClass = computed(() => (props.rightPane === "tools" ? CELL_BTN_ACTIVE : CELL_BTN));
</script>

<template>
  <button
    class="cell-btn"
    :class="CELL_BTN"
    :title="expanded ? 'Restore' : 'Expand'"
    :aria-label="expanded ? 'Restore terminal' : 'Expand terminal'"
    @click="emit('toggle-expand')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">{{ expanded ? "close_fullscreen" : "open_in_full" }}</span>
  </button>
  <!-- Only while enlarged: the pane splits the enlarged cell's room, which a tiled cell or a
       filmstrip thumbnail does not have. After expand/restore so the first `.cell-btn` keeps
       meaning what it always did. -->
  <button
    v-if="expanded"
    class="cell-btn"
    :class="filesClass"
    :aria-pressed="!!filesOpen"
    :title="filesOpen ? 'Hide files' : 'Show files'"
    :aria-label="filesOpen ? 'Hide files' : 'Show files'"
    @click="emit('toggle-files')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
  </button>
  <!-- Shown but DISABLED when this session has no render MCP: the pane would open empty and
       never fill, and hiding the button outright leaves nothing to explain why. The title is
       where the fix goes, since a disabled control is the moment someone asks. -->
  <button
    v-if="expanded"
    data-testid="cell-canvas-btn"
    class="cell-btn"
    :class="canvasClass"
    :disabled="!canvasAvailable"
    :aria-pressed="rightPane === 'canvas'"
    :title="canvasTitle"
    :aria-label="canvasTitle"
    @click="emit('toggle-canvas')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">draw</span>
  </button>
  <button
    v-if="expanded"
    class="cell-btn"
    :class="toolsClass"
    :aria-pressed="rightPane === 'tools'"
    :title="rightPane === 'tools' ? 'Hide tools' : 'Show tools'"
    :aria-label="rightPane === 'tools' ? 'Hide tools' : 'Show tools'"
    @click="emit('toggle-tools')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">build</span>
  </button>
  <button class="cell-btn cell-close" :class="CELL_CLOSE_BTN" title="Close terminal" aria-label="Close terminal" @click="emit('close')">
    <span class="material-symbols-outlined" aria-hidden="true">close</span>
  </button>
</template>
