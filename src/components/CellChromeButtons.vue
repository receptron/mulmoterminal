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
import { useI18n } from "vue-i18n";
import CellPaneMenu from "./CellPaneMenu.vue";
import { actionsOnly, hasChoice, historyEntries, toolEntries, type CellPaneMenuId, type CellPaneMenuState } from "./cellPaneMenuEntries";
import { CELL_BTN, CELL_BTN_ACTIVE, CELL_CLOSE_BTN } from "./cellChromeClasses";
import type { RightPane } from "./gridCell";

const props = defineProps<{
  expanded: boolean;
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
  // Whether this cell can be set aside at all (#992) — only a session terminal can, and it is the
  // only caller that passes this. It is a prop of its own rather than the absence of `parked`
  // below, because Vue casts an ABSENT boolean prop to `false`: `parked === undefined` is never
  // true, so a guard written that way rendered the button on every cell type, including the
  // command and launcher cells, whose event binding deliberately omits `toggle-park` — so it
  // clicked and did nothing (#2007).
  canPark?: boolean;
  // Whether this cell is currently set aside, i.e. the button's pressed state. Only read where
  // `canPark` is true.
  parked?: boolean;
  // Drop the expand button, because enlarging would do nothing anyone can SEE. True only in the
  // collection pane, which is an overlay on top of the grid and wins over the zoom underneath it:
  // the button would set a state nobody sees until they leave, which reads as a broken control.
  //
  // Stated negatively on purpose (`hideHeader` on Terminal is the same shape): Vue casts an absent
  // boolean prop to `false` at EVERY level it passes through, so a positive "expandable" would have
  // to survive being defaulted to false in each one (#2001).
  hideExpand?: boolean;
  // A filmstrip thumbnail shows only close: at its width the rest did not fit and was cut off, and
  // the thumbnail itself enlarges on a click, so expand has nowhere to add anything.
  closeOnly?: boolean;
  // Whether this cell has an Activity timeline to open — a Claude session only. Like `canPark`, only
  // the cell that has one passes it, and it binds `open-timeline` itself.
  timelineAvailable?: boolean;
  // Whether this session can be opened in the Library — a Claude session. Only TerminalCell passes
  // it, and it binds `open-library` itself.
  libraryAvailable?: boolean;
  // Whether this cell has an agent session to restart. Only TerminalCell passes it, and it binds
  // `restart-agent` itself.
  restartAvailable?: boolean;
  // Whether another terminal is there to talk to. Only TerminalCell passes it, and it binds
  // `open-talk` itself; it refreshes the answer on `tools-opening`.
  talkAvailable?: boolean;
  // A remote cell (#3506): every pane reads this machine's copy of the session, which it has none of.
  panesHidden?: boolean;
  // Except its session's own panes, which a remote agent cell reads on its host: its history, and
  // its tool calls.
  sessionOnHost?: boolean;
}>();
const emit = defineEmits<{
  (
    e:
      | "toggle-expand"
      | "close"
      | "toggle-canvas"
      | "toggle-tools"
      | "toggle-collections"
      | "toggle-prompts"
      | "toggle-transcript"
      | "toggle-park"
      | "open-timeline"
      | "open-library"
      | "open-talk"
      | "tools-opening"
      | "restart-agent",
  ): void;
}>();

// History and tools as two menus rather than five look-alike glyphs (#2311). What each lists, and
// when an entry is disabled, is cellPaneMenuEntries'; this only maps a pick back to its event.
const { t } = useI18n();
const menuState = computed<CellPaneMenuState>(() => ({
  rightPane: props.rightPane ?? null,
  canvasAvailable: !!props.canvasAvailable,
  collectionsAvailable: !!props.collectionsAvailable,
  timelineAvailable: !!props.timelineAvailable,
  libraryAvailable: !!props.libraryAvailable,
  restartAvailable: !!props.restartAvailable,
  talkAvailable: !!props.talkAvailable,
}));
const history = computed(() => historyEntries(menuState.value, t));
const keptOnHost = computed<CellPaneMenuId[]>(() => (props.sessionOnHost ? ["tools"] : []));
const tools = computed(() => (props.panesHidden ? actionsOnly(toolEntries(menuState.value, t), keptOnHost.value) : toolEntries(menuState.value, t)));

const PICK_EVENT = {
  prompts: "toggle-prompts",
  transcript: "toggle-transcript",
  timeline: "open-timeline",
  library: "open-library",
  tools: "toggle-tools",
  canvas: "toggle-canvas",
  collections: "toggle-collections",
  talk: "open-talk",
  restart: "restart-agent",
} as const satisfies Record<CellPaneMenuId, string>;
const onPick = (id: CellPaneMenuId) => emit(PICK_EVENT[id]);

// Pressed buttons get a DIFFERENT class string, not an extra one: the two carry competing `bg-*`
// utilities, and appending would leave which of them wins to Tailwind's output order.
const parkClass = computed(() => (props.parked ? CELL_BTN_ACTIVE : CELL_BTN));
// The label says what the click DOES, and names the guarantee the user is buying: the cell stays
// open and keeps its history. That is the whole reason this exists instead of `/clear`.
const parkTitle = computed(() => (props.parked ? t("tips.cell.wake") : t("tips.cell.setAside")));
</script>

<template>
  <template v-if="!closeOnly">
    <CellPaneMenu
      v-if="(!panesHidden || sessionOnHost) && hasChoice(history)"
      icon="history"
      :label="t('cellMenu.history')"
      testid="cell-history-btn"
      :entries="history"
      @select="onPick"
    />
    <CellPaneMenu
      v-if="hasChoice(tools)"
      icon="build"
      :label="t('cellMenu.tools')"
      testid="cell-tools-btn"
      :entries="tools"
      @select="onPick"
      @opening="emit('tools-opening')"
    />
    <!-- Before close on purpose: the two are the choice the user is making — set it aside, or end
       it — and the reversible one should not sit past the one that tears a session down. -->
    <button
      v-if="canPark"
      data-testid="cell-park-btn"
      class="cell-btn"
      :class="parkClass"
      :aria-pressed="!!parked"
      :data-tip="parkTitle"
      :aria-label="parkTitle"
      @click="emit('toggle-park')"
    >
      <span class="material-symbols-outlined" aria-hidden="true">hotel</span>
    </button>
    <!-- Beside close: the two change how much of the screen this cell takes, so they sit together at
       the header's edge, where a hand reaching for the corner finds them. -->
    <button
      v-if="!hideExpand"
      class="cell-btn"
      :class="CELL_BTN"
      :data-tip="expanded ? t('tips.cell.restore') : t('tips.cell.expand')"
      :aria-label="expanded ? t('tips.cell.restoreTerminal') : t('tips.cell.expandTerminal')"
      @click="emit('toggle-expand')"
    >
      <span class="material-symbols-outlined" aria-hidden="true">{{ expanded ? "close_fullscreen" : "open_in_full" }}</span>
    </button>
  </template>
  <button
    class="cell-btn cell-close"
    :class="CELL_CLOSE_BTN"
    :data-tip="t('tips.cell.closeTerminal')"
    :aria-label="t('tips.cell.closeTerminal')"
    @click="emit('close')"
  >
    <span class="material-symbols-outlined" aria-hidden="true">power_settings_new</span>
  </button>
</template>
