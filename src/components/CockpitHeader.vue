<script setup lang="ts">
// The status/dir header bar shared by the cockpit roster rows and the strip thumbnails, so both
// read as the same directory: the bar is always tinted with the dir's configured header colour
// (status is carried by the dot + badge, not the bar background), with the roster's status
// wording. Trailing controls — the roster's ⋮ reorder menu, or a thumbnail's expand/close —
// go in the default slot.
import { computed } from "vue";
import { formatCwd } from "./cwdDisplay";
import { headerStyleFor } from "./cellHeaderStyle";
import { phaseDisplay, WORK_WORD, type PrPhase, type WorkPhase } from "./rosterPhase";
import type { CellStatus } from "./gridTabs";

const props = withDefaults(
  defineProps<{
    status: CellStatus;
    agent: string;
    cwd: string | null;
    home: string | null;
    headerColor: string | null;
    headerTextColor: string | null;
    workPhase?: WorkPhase | null;
    phase?: PrPhase;
    dirLength?: number;
  }>(),
  { workPhase: null, phase: "none", dirLength: 44 },
);

const STATUS_WORD: Record<CellStatus, string> = { working: "running", blocked: "waiting", done: "done", idle: "idle" };
// Hardcoded, token-less roster hues — come through as arbitrary utilities; fill + text paired.
const DOT_CLASS: Record<CellStatus, string> = { working: "bg-[#4a9eff]", done: "bg-[#22c55e]", blocked: "bg-[#f59e0b]", idle: "bg-[#666]" };
const BADGE_CLASS: Record<CellStatus, string> = {
  working: "bg-[#4a9eff] text-[#04121f]",
  done: "bg-[#22c55e] text-[#04120a]",
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
const phaseColor = computed(() => PHASE_CLASS[props.phase ?? "none"] ?? "text-[#9aa4b2]");
const dirText = computed(() => formatCwd(props.cwd, props.home, props.dirLength ?? 44) || "—");
const barStyle = computed(() => headerStyleFor(props.headerColor, props.headerTextColor));
</script>

<template>
  <div
    data-testid="cockpit-header"
    class="flex min-w-0 items-center gap-1.5 bg-[var(--cell-header-bg,transparent)] px-2.5 py-1.5 text-[var(--cell-header-fg,inherit)]"
    :style="barStyle"
  >
    <span class="h-2 w-2 flex-none rounded-full" :class="DOT_CLASS[status]" aria-hidden="true" />
    <span data-testid="cockpit-badge" class="flex-none rounded-full px-1.5 py-px text-[10px] font-bold" :class="BADGE_CLASS[status]">{{ badgeWord }}</span>
    <span
      v-if="phaseInfo"
      data-testid="cockpit-phase"
      class="flex-none whitespace-nowrap rounded-full border border-current px-1.5 text-[10px] font-bold"
      :class="[`ph-${phase}`, phaseColor]"
      :title="phaseInfo.title"
      >{{ phaseInfo.label }}</span
    >
    <span v-if="agent === 'codex'" class="flex-none rounded-[4px] border border-border px-1 text-[10px] text-[#9ab]">codex</span>
    <span class="min-w-0 flex-auto truncate text-[11px] text-[var(--cell-header-fg,var(--text-dim))]">{{ dirText }}</span>
    <slot />
  </div>
</template>
