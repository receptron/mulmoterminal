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
import type { RightPane } from "./gridCell";

const props = defineProps<{
  expanded: boolean;
  filesOpen?: boolean;
  // Which side pane this cell is showing, so each button can read as pressed. They share one slot
  // beside the enlarged terminal, so at most one is ever pressed. The grid's own type rather than
  // a copy of its members: spelling the union again here is how a new pane came to be a type error
  // in every caller of this component instead of a value it simply did not recognise.
  rightPane?: RightPane | null | undefined;
  // Whether this cell's session actually has the drawing tools — i.e. whether its directory has
  // the `render` MCP group registered with Claude Code. False disables the button rather than
  // removing it: the pane would open empty, and that is worth SAYING rather than hiding.
  canvasAvailable?: boolean;
  // Whether this cell's directory has the collection tools — the `data` MCP group, which is what
  // manageCollection is served under. False REMOVES the button, where canvasAvailable only
  // disables its own: a pane the agent cannot act on is not worth a control to explain.
  collectionsAvailable?: boolean;
  // Whether this cell is set aside (#992). Present ONLY on a cell that can be parked — a session
  // terminal. Left undefined, the button is not rendered at all, which is how the command and
  // launcher cells opt out without declaring anything: an ephemeral run and an empty launch slot
  // have nothing to come back to.
  parked?: boolean | undefined;
}>();
const emit = defineEmits<{
  (
    e:
      "toggle-expand" | "close" | "toggle-files" | "toggle-canvas" | "toggle-tools" | "toggle-collections" | "toggle-github" | "toggle-prompts" | "toggle-park",
  ): void;
}>();

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
// "Prompts" names whose text it is, which is the whole distinction from the Activity timeline in
// the same header: that one is what the agent RAN, this one is what it was asked for.
const promptsClass = computed(() => (props.rightPane === "prompts" ? CELL_BTN_ACTIVE : CELL_BTN));
const promptsTitle = computed(() => (props.rightPane === "prompts" ? "Hide prompts" : "Show the prompts you sent this session"));
const collectionsClass = computed(() => (props.rightPane === "collections" ? CELL_BTN_ACTIVE : CELL_BTN));
// Names the DIRECTORY as the scope, because that is the part with no other affordance: nothing
// else in the header says the pane is this cell's collections rather than the workspace's.
const collectionsTitle = computed(() => (props.rightPane === "collections" ? "Hide collections" : "Show this folder's collections"));

// Scoped like collections — by the CELL's directory. The pane shows every configured repo
// either way; what the directory decides is which one leads (common/githubPaneOrder.ts), so a
// cell whose folder names no repository still opens a useful list.
const githubClass = computed(() => (props.rightPane === "github" ? CELL_BTN_ACTIVE : CELL_BTN));
const githubTitle = computed(() => (props.rightPane === "github" ? "Hide GitHub" : "Show GitHub PRs and issues"));
// A different class string rather than an extra one, for the same reason as the panes above.
const parkClass = computed(() => (props.parked ? CELL_BTN_ACTIVE : CELL_BTN));
// The label says what the click DOES, and names the guarantee the user is buying: the cell stays
// open and keeps its history. That is the whole reason this exists instead of `/clear`.
const parkTitle = computed(() => (props.parked ? "Wake this terminal" : "Set aside (stays open, keeps its history)"));
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
  <!-- Shown on every cell type while enlarged, like tools: a cell with no agent has no prompts,
       and a pane that SAYS so is better than a button that is missing for a reason nobody can
       see. -->
  <button
    v-if="expanded"
    data-testid="cell-prompts-btn"
    class="cell-btn"
    :class="promptsClass"
    :aria-pressed="rightPane === 'prompts'"
    :title="promptsTitle"
    :aria-label="promptsTitle"
    @click="emit('toggle-prompts')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">forum</span>
  </button>
  <!-- Scoped to THIS cell's directory — a Project is a directory, so the cell is the picker.
       Only where the directory HAS the collection tools — OR where the pane is already open,
       because this button is also its only close: the Collections pane renders no control of its
       own, so hiding this one mid-session strands the pane for the life of the cell. That clause
       lives HERE, next to the `v-if` it guards, rather than in the grid's prop: the rule belongs
       to whoever renders the button, and `rightPane` here is THIS cell's pane, which is the more
       precise question. -->
  <button
    v-if="expanded && (collectionsAvailable || rightPane === 'collections')"
    class="cell-btn"
    :class="collectionsClass"
    :aria-pressed="rightPane === 'collections'"
    :title="collectionsTitle"
    :aria-label="collectionsTitle"
    @click="emit('toggle-collections')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">database</span>
  </button>
  <button
    v-if="expanded"
    data-testid="cell-github-btn"
    class="cell-btn"
    :class="githubClass"
    :aria-pressed="rightPane === 'github'"
    :title="githubTitle"
    :aria-label="githubTitle"
    @click="emit('toggle-github')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">merge</span>
  </button>
  <!-- Before close on purpose: the two are the choice the user is making — set it aside, or end
       it — and the reversible one should not sit past the one that tears a session down. -->
  <button
    v-if="parked !== undefined"
    data-testid="cell-park-btn"
    class="cell-btn"
    :class="parkClass"
    :aria-pressed="parked"
    :title="parkTitle"
    :aria-label="parkTitle"
    @click="emit('toggle-park')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">bedtime</span>
  </button>
  <button class="cell-btn cell-close" :class="CELL_CLOSE_BTN" title="Close terminal" aria-label="Close terminal" @click="emit('close')">
    <span class="material-symbols-outlined" aria-hidden="true">close</span>
  </button>
</template>
