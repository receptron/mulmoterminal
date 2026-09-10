<script setup lang="ts">
// The status/dir header bar shared by the cockpit roster rows and the strip thumbnails, so both
// read as the same directory: the bar is always tinted with the dir's configured header colour
// (status is carried by the dot + badge, not the bar background), with the roster's status
// wording. Trailing controls — the roster's ⋮ reorder menu, or a thumbnail's expand/close —
// go in the default slot.
import { computed } from "vue";
import DirIcon from "./DirIcon.vue";
import CollectionMark from "./CollectionMark.vue";
import type { SessionCollection } from "../../common/sessionCollection";
import { formatCwd } from "./cwdDisplay";
import { CELL_DIR_PATH, DIR_TRUNCATE_FRONT } from "./cellChromeClasses";
import { headerStyleFor } from "./cellHeaderStyle";
import { HOVER_TIP_ID, useHoverTipAnchor } from "../composables/useHoverTip";
import { phaseDisplay, WORK_WORD, type PrPhase, type WorkPhase } from "./rosterPhase";
import { textTip } from "./tipContent";
import type { AttentionStatus } from "./attentionStatus";
import AgentMark from "./AgentMark.vue";
import { isTerminalAgent, type TerminalAgent } from "../../common/sessionAgent";

const props = withDefaults(
  defineProps<{
    status: AttentionStatus;
    // What the row is running, or null when nothing does yet (an empty cell) — see rosterAgent()
    // in GridView.vue for how a cell answers this.
    agent: string | null;
    cwd: string | null;
    home: string | null;
    headerColor: string | null;
    headerTextColor: string | null;
    // The directory's `icon` image (#1421), already resolved to something an <img> can load.
    iconUrl?: string | null;
    // The collection this session was started from (#2020), or null when it was not started from
    // one. A different question from `iconUrl` — see CollectionMark.
    collection?: SessionCollection | null;
    workPhase?: WorkPhase | null;
    phase?: PrPhase;
    dirLength?: number;
  }>(),
  { iconUrl: null, collection: null, workPhase: null, phase: "none", dirLength: 44 },
);

const STATUS_WORD: Record<AttentionStatus, string> = { working: "running", blocked: "waiting", done: "done", idle: "idle" };
// Hardcoded, token-less roster hues — come through as arbitrary utilities; fill + text paired.
// `done` is the exception: it names --done, the one green every view paints a finished turn with
// (#1307), so it cannot drift from the cell's ring or the row's edge.
const DOT_CLASS: Record<AttentionStatus, string> = { working: "bg-[#4a9eff]", done: "bg-done", blocked: "bg-[#f59e0b]", idle: "bg-[#666]" };
const BADGE_CLASS: Record<AttentionStatus, string> = {
  working: "bg-[#4a9eff] text-[#04121f]",
  done: "bg-done text-[#04120a]",
  blocked: "bg-[#f59e0b] text-[#1f1300]",
  idle: "bg-[#333] text-[#ddd]",
};
// Outlined pill, coloured by PR lifecycle; anything unlisted keeps the neutral grey.
const PHASE_CLASS: Record<string, string> = {
  "ci-running": "text-[#4a9eff]",
  "ci-failing": "text-[#f87171]",
  "changes-requested": "text-[#f59e0b]",
  ready: "text-[#22c55e]",
  merged: "text-[#a78bfa]",
};

// A working cell shows what it's doing (planning / editing) when known, else the plain word.
const badgeWord = computed(() => (props.status === "working" && props.workPhase ? WORK_WORD[props.workPhase] : STATUS_WORD[props.status]));
const phaseInfo = computed(() => phaseDisplay(props.phase ?? "none"));

// The roster row is its own template, not a TerminalCell (docs/grid-view-modes.md), so it binds the
// shared tip itself. Its two chips are the ones that hide something: a phase pill abbreviated to a
// word, and a path truncated from the front.
const { described: phaseDescribed, show: showPhaseTip, hide: hidePhaseTip } = useHoverTipAnchor(() => textTip(phaseInfo.value?.title));
const { described: dirDescribed, show: showDirTip, hide: hideDirTip } = useHoverTipAnchor(() => textTip(props.cwd));
const agentMark = computed<TerminalAgent | null>(() => (props.agent !== null && isTerminalAgent(props.agent) ? props.agent : null));
// Same non-agent icon as the Agent Picker. Anything else — an empty cell, a session kind this
// build does not know — gets no mark at all: the status dot and the directory still identify the
// row, and defaulting to Claude's burst would tell the reader a launcher is an agent session.
const agentSymbol = computed(() => (props.agent === "shell" ? "terminal" : null));
// Names the mark for assistive tech, which cannot read a drawn glyph. The title says the same
// thing on hover.
const agentName = computed(() => agentMark.value ?? (agentSymbol.value ? "shell" : null));
const phaseColor = computed(() => PHASE_CLASS[props.phase ?? "none"] ?? "text-[#9aa4b2]");
const dirText = computed(() => formatCwd(props.cwd, props.home, props.dirLength ?? 44) || "—");
// `true`: this bar is tinted with the directory's colour in every status (the status is the dot and
// the badge), so a text colour derived from that tint is the one that lands on it.
const barStyle = computed(() => headerStyleFor(props.headerColor, props.headerTextColor));
</script>

<template>
  <div
    data-testid="cockpit-header"
    class="flex min-w-0 items-center gap-1.5 bg-[var(--cell-header-bg,transparent)] px-2.5 py-1.5 text-[var(--cell-header-fg,inherit)]"
    :style="barStyle"
  >
    <!-- Leads the bar, ahead of the status dot — the browser-tab position (see TerminalCell). -->
    <DirIcon :src="iconUrl" />
    <span data-testid="cockpit-dot" class="h-2 w-2 flex-none rounded-full" :class="DOT_CLASS[status]" aria-hidden="true" />
    <!-- Same place as the cell header's, so a row and its cell read as the same session. -->
    <CollectionMark :collection="collection" />
    <span data-testid="cockpit-badge" class="flex-none rounded-full px-1.5 py-px text-[10px] font-bold" :class="BADGE_CLASS[status]">{{ badgeWord }}</span>
    <span
      v-if="phaseInfo"
      data-testid="cockpit-phase"
      class="flex-none whitespace-nowrap rounded-full border border-current px-1.5 text-[10px] font-bold"
      :class="[`ph-${phase}`, phaseColor]"
      :aria-describedby="phaseDescribed ? HOVER_TIP_ID : undefined"
      @pointerenter="showPhaseTip"
      @pointerleave="hidePhaseTip"
      @focusin="showPhaseTip"
      @focusout="hidePhaseTip"
      >{{ phaseInfo.label }}</span
    >
    <span
      v-if="agentName"
      data-testid="cockpit-agent-icon"
      class="inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[4px] border border-border text-[#9ab]"
      role="img"
      :title="agentName"
      :aria-label="agentName"
    >
      <AgentMark v-if="agentMark" :agent="agentMark" />
      <!-- A Material Symbol is a LIGATURE, so the icon's name is real text inside the row; hidden
           here for the same reason the Agent Picker hides it, so only the aria-label is read. -->
      <span v-else class="material-symbols-outlined text-[13px]" aria-hidden="true">{{ agentSymbol }}</span>
    </span>
    <span
      data-testid="cockpit-dir"
      class="min-w-0 flex-auto text-[11px] text-[var(--cell-header-fg,var(--text-dim))]"
      :class="DIR_TRUNCATE_FRONT"
      :aria-describedby="dirDescribed ? HOVER_TIP_ID : undefined"
      @pointerenter="showDirTip"
      @pointerleave="hideDirTip"
      @focusin="showDirTip"
      @focusout="hideDirTip"
      ><span :class="CELL_DIR_PATH">{{ dirText }}</span></span
    >
    <slot />
  </div>
</template>
