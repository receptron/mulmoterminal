<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch, nextTick } from "vue";
import TerminalCell from "./TerminalCell.vue";
import CommandCell from "./CommandCell.vue";
import LauncherCell from "./LauncherCell.vue";
import * as conn from "../composables/useTerminalConnections";
import { trackStyle, layoutForCount } from "./gridLayout";
import { flipKeyframes, flipPairs, FLIP_MS, FLIP_EASING } from "./cellFlip";
import { formatCwd } from "./cwdDisplay";
import type { Cell, CellStatus } from "./gridTabs";
import type { RunCommand } from "./runCommand";
import { phaseDisplay, WORK_WORD, type PrPhase, type WorkPhase } from "./rosterPhase";
import type { CwdPreset } from "./presets";
import type { Launcher, LaunchPick } from "./launchers";
import { shouldFlipZoom } from "./cellChromeRules";

// Renders the grid, auto-sized to the cell count, fully controlled by GridView:
// `cells` is the active page's slice (≤9) when nothing is zoomed, and `expandedUid`
// the zoomed cell; every change is emitted up by uid.
// Expanding a cell switches to a filmstrip — the zoomed cell (teleported to the
// overlay) fills the top, the rest line up in a scrollable strip below. While
// zoomed, GridView passes EVERY cell (all tabs), so the strip shows them all live.
// A cell carrying a `command` renders as a CommandCell (a running script.json
// command) instead of the Claude launcher/terminal.
export interface CockpitRow {
  uid: number;
  cwd: string | null;
  agent: string;
  status: CellStatus;
  summary: string | null; // AI title
  prompt: string | null; // current user prompt
  response: string | null; // tail of the agent's latest reply
  fallback: string | null; // label when there's no prompt/summary yet (launcher/command name)
  phase: PrPhase; // the branch's PR workflow phase (`none` until a PR exists)
  workPhase: WorkPhase | null; // planning vs editing while working; null when unknown / not working
}
const STATUS_WORD: Record<CellStatus, string> = { working: "running", blocked: "waiting", done: "done", idle: "idle" };
// A working cell shows what it's doing (planning / editing) when known, else the plain word.
const statusWord = (row: CockpitRow): string => (row.status === "working" && row.workPhase ? WORK_WORD[row.workPhase] : STATUS_WORD[row.status]);
// Roster colours. These hues are hardcoded and token-less, so they come through as
// arbitrary utilities; returning fill+text together keeps the pair in one place.
const DOT_CLASS: Record<CellStatus, string> = {
  working: "bg-[#4a9eff]",
  done: "bg-[#22c55e]",
  blocked: "bg-[#f59e0b]",
  idle: "bg-[#666]",
};
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
const phaseClass = (phase: PrPhase): string => PHASE_CLASS[phase] ?? "text-[#9aa4b2]";
const props = defineProps<{
  cells: Cell[];
  expandedUid: number | null;
  // A text row per cell for the cockpit list shown beside the expanded terminal.
  listRows: CockpitRow[];
  cancelUid: number | null;
  defaultCwd: string | null;
  presets: CwdPreset[];
  launchers: Launcher[];
  home: string | null;
  // Manual sort mode: each cell shows ◀▶ to reorder.
  reorderable?: boolean;
  openSessionIds: string[];
  openCwds: string[];
}>();
const emit = defineEmits<{
  (e: "session" | "cwd", uid: number, value: string): void;
  (e: "close" | "toggle-expand", uid: number): void;
  (e: "run" | "runSpare", uid: number, command: RunCommand): void;
  (e: "launch", uid: number, pick: LaunchPick): void;
  (e: "move", uid: number, dir: -1 | 1): void;
  (e: "status", uid: number, value: CellStatus): void;
  (e: "agent", uid: number, value: "claude" | "codex"): void;
  // Roster shown (true) / thumbnail strip (false), so the parent can pause the roster-only poll.
  (e: "list-mode", on: boolean): void;
  // Shared preset list events — uid-less since they mutate the one config list.
  (e: "record-cwd" | "remove-preset", value: string): void;
}>();

const gridStyle = computed(() => trackStyle(layoutForCount(props.cells.length)));

// The keyboard-focused cell, so it can lift + zoom slightly in place. `focusin` bubbles from the
// xterm textarea up to the grid, so one delegated listener suffices. It's sticky: focus moving to
// the toolbar doesn't reset it — only another cell taking focus moves the emphasis.
const focusedUid = ref<number | null>(null);
function onFocusIn(e: FocusEvent) {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const el = target.closest<HTMLElement>("[data-uid]");
  if (el?.dataset.uid) focusedUid.value = Number(el.dataset.uid);
}

// Returning to the grid via a top-tab switch reactivates it under <KeepAlive>, which does
// NOT re-run the cells' attach()/focus() — so nothing restores the cursor. Put it back in
// whichever cell last held it (sticky `focusedUid`, tracked in both the grid and the
// zoomed slot). Grid cells' durable connections are keyed `cell-<uid>`.
onActivated(() => {
  const uid = focusedUid.value;
  if (uid !== null) nextTick(() => conn.focus(`cell-${uid}`));
});
// Per-cell class: `flipping` drives the zoom FLIP, `focused` the in-place lift of the active cell —
// suppressed while expanded or mid-flip so it never fights those animations.
function cellClass(uid: number) {
  return {
    flipping: flippingUids.value.has(uid),
    focused: uid === focusedUid.value && props.expandedUid === null && !flippingUids.value.has(uid),
  };
}
// Hand the flip's timing to the stylesheet so the fade under it can't drift out of sync.
const flipVars = { "--flip-ms": `${FLIP_MS}ms`, "--flip-ease": FLIP_EASING };

// The zoomed cell is teleported up here; the target must exist before it moves, so
// hold off until mounted (covers a reload that restores a zoom).
const zoomMain = ref<HTMLElement | null>(null);
const mounted = ref(false);
onMounted(() => (mounted.value = true));
const zoomed = computed(() => props.expandedUid !== null && mounted.value);
// While zoomed, show the cockpit roster (true) or the old thumbnail filmstrip (false).
const listMode = ref(true);
// The roster is the only consumer of the parent's /api/session poll — tell it when we hide it.
watch(listMode, (on) => emit("list-mode", on));

const stage = ref<HTMLElement | null>(null);
// The cells currently flying between slots. Also gates the stylesheet: the cells not in
// flight fade in under them, and the stage stops taking clicks until the batch lands.
const flippingUids = ref<Set<number>>(new Set());
// One expand/collapse is one batch. A newer batch cancels every animation the last one
// still had running, so a fast double-click never leaves a cell stranded mid-transform.
let running: Animation[] = [];

const cellEl = (uid: number) => stage.value?.querySelector<HTMLElement>(`[data-uid="${uid}"]`) ?? null;

// Measure every currently-rendered cell's slot. Taken once before the patch and once
// after; flipPairs keeps only the cells in both, and each flies from its own old slot.
function measureCells(uids: number[]): Map<number, DOMRect> {
  const rects = new Map<number, DOMRect>();
  for (const uid of uids) {
    const el = cellEl(uid);
    if (el) rects.set(uid, el.getBoundingClientRect());
  }
  return rects;
}

function flipCells(before: Map<number, DOMRect>) {
  const after = measureCells([...before.keys()]);
  const animations = flipPairs(before, after)
    .map(({ uid, first, last }) => {
      const el = cellEl(uid);
      const frames = el && flipKeyframes(first, last);
      return el && frames ? { uid, anim: el.animate(frames, { duration: FLIP_MS, easing: FLIP_EASING }) } : null;
    })
    .filter((x): x is { uid: number; anim: Animation } => x !== null);
  if (!animations.length) return;

  running.forEach((a) => a.cancel());
  const batch = animations.map((a) => a.anim);
  running = batch;
  flippingUids.value = new Set(animations.map((a) => a.uid));
  const settle = () => {
    if (running !== batch) return; // a newer batch took over — it owns the class now
    running = [];
    flippingUids.value = new Set();
  };
  // The batch shares one duration + easing, so the last to finish settles them all.
  Promise.allSettled(batch.map((a) => a.finished)).then(settle);
}

// Pre-flush, so the cells are still in the slots they are leaving when we measure them.
// EVERY rendered cell is measured, not just the one being zoomed, so the filmstrip cells
// slide into place alongside it instead of snapping.
watch(
  () => props.expandedUid,
  (to, from) => {
    if (!shouldFlipZoom(to, from, window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    const before = measureCells(props.cells.map((c) => c.uid));
    nextTick(() => flipCells(before));
  },
);
</script>

<template>
  <div ref="stage" class="stage" :class="{ zoomed, listmode: listMode, flipping: flippingUids.size > 0 }" :style="flipVars" @focusin="onFocusIn">
    <!-- toggle the zoomed side panel between the text roster and the old thumbnail strip. -->
    <button
      v-if="zoomed"
      type="button"
      data-testid="view-toggle"
      class="absolute right-3 top-2 z-10 h-[26px] w-[26px] cursor-pointer rounded-md border border-border bg-panel text-[13px] leading-none text-fg"
      :title="listMode ? 'Show thumbnails' : 'Show list'"
      :aria-label="listMode ? 'Switch to thumbnail strip' : 'Switch to list'"
      @click="listMode = !listMode"
    >
      {{ listMode ? "▤" : "☰" }}
    </button>
    <!-- Cockpit roster: a tall text row per cell (status / dir / summary / prompt / latest
         reply). Click a row to swap which terminal is enlarged. -->
    <aside v-if="zoomed && listMode" data-testid="cockpit" class="flex min-w-0 shrink-0 grow-0 basis-[360px] flex-col gap-[5px] overflow-y-auto bg-deep p-1.5">
      <button
        v-for="row in listRows"
        :key="row.uid"
        type="button"
        data-testid="cockpit-row"
        class="flex cursor-pointer flex-col gap-1 rounded-lg border border-l-[3px] bg-panel px-2.5 py-2 text-left text-fg [font:inherit] hover:brightness-[1.15]"
        :class="row.uid === expandedUid ? 'border-[#4a9eff] border-l-[#4a9eff]' : 'border-border border-l-transparent'"
        @click="row.uid !== expandedUid && emit('toggle-expand', row.uid)"
      >
        <span class="flex min-w-0 items-center gap-1.5">
          <span class="h-2 w-2 flex-none rounded-full" :class="DOT_CLASS[row.status]" aria-hidden="true" />
          <span data-testid="cockpit-badge" class="flex-none rounded-full px-1.5 py-px text-[10px] font-bold" :class="BADGE_CLASS[row.status]">{{
            statusWord(row)
          }}</span>
          <span
            v-if="phaseDisplay(row.phase)"
            data-testid="cockpit-phase"
            class="flex-none whitespace-nowrap rounded-full border border-current px-1.5 text-[10px] font-bold"
            :class="[`ph-${row.phase}`, phaseClass(row.phase)]"
            :title="phaseDisplay(row.phase)?.title"
          >
            {{ phaseDisplay(row.phase)?.label }}
          </span>
          <span v-if="row.agent === 'codex'" class="flex-none rounded-[4px] border border-border px-1 text-[10px] text-[#9ab]">codex</span>
          <span class="min-w-0 flex-auto truncate text-[11px] text-dim">{{ formatCwd(row.cwd, home, 44) || "—" }}</span>
        </span>
        <span v-if="row.summary" data-testid="cockpit-line" class="line-clamp-2 overflow-hidden text-[12px] leading-[1.35]"
          ><b class="mr-1 text-[10px] font-bold text-[#7a8aa0]">summary</b> {{ row.summary }}</span
        >
        <span data-testid="cockpit-line" class="line-clamp-2 overflow-hidden text-[12px] leading-[1.35]"
          ><b class="mr-1 text-[10px] font-bold text-[#7a8aa0]">prompt</b> {{ row.prompt || row.fallback || "—" }}</span
        >
        <span v-if="row.response" data-testid="cockpit-line" class="line-clamp-3 overflow-hidden text-[12px] leading-[1.35] text-dim"
          ><b class="mr-1 text-[10px] font-bold text-[#7a8aa0]">reply</b> {{ row.response }}</span
        >
      </button>
    </aside>
    <div ref="zoomMain" class="zoom-main" />
    <div class="grid" :style="gridStyle">
      <Teleport v-for="cell in cells" :key="cell.uid" :to="zoomMain" :disabled="!(zoomed && cell.uid === expandedUid)">
        <CommandCell
          v-if="cell.command"
          :data-uid="cell.uid"
          :class="cellClass(cell.uid)"
          :expanded="cell.uid === expandedUid"
          :zoomed="zoomed"
          :command="cell.command"
          :home="home"
          :reorderable="reorderable"
          @toggle-expand="emit('toggle-expand', cell.uid)"
          @close="emit('close', cell.uid)"
          @move="(dir) => emit('move', cell.uid, dir)"
          @status="(s) => emit('status', cell.uid, s)"
        />
        <LauncherCell
          v-else-if="cell.launcher"
          :uid="cell.uid"
          :data-uid="cell.uid"
          :class="cellClass(cell.uid)"
          :expanded="cell.uid === expandedUid"
          :zoomed="zoomed"
          :launcher="cell.launcher"
          :session="cell.session"
          :cwd="cell.cwd"
          :home="home"
          :reorderable="reorderable"
          @toggle-expand="emit('toggle-expand', cell.uid)"
          @close="emit('close', cell.uid)"
          @move="(dir) => emit('move', cell.uid, dir)"
          @status="(s) => emit('status', cell.uid, s)"
          @session="(id) => emit('session', cell.uid, id)"
        />
        <TerminalCell
          v-else
          :uid="cell.uid"
          :data-uid="cell.uid"
          :class="cellClass(cell.uid)"
          :expanded="cell.uid === expandedUid"
          :zoomed="zoomed"
          :initial-session-id="cell.session"
          :initial-cwd="cell.cwd"
          :initial-agent="cell.agent"
          :default-cwd="defaultCwd"
          :presets="presets"
          :launchers="launchers"
          :home="home"
          :open-session-ids="openSessionIds"
          :open-cwds="openCwds"
          :cancellable="cell.uid === cancelUid"
          :reorderable="reorderable"
          @toggle-expand="emit('toggle-expand', cell.uid)"
          @session="(id) => emit('session', cell.uid, id)"
          @agent="(a) => emit('agent', cell.uid, a)"
          @cwd="(c) => emit('cwd', cell.uid, c)"
          @record-cwd="(c) => emit('record-cwd', c)"
          @remove-preset="(path) => emit('remove-preset', path)"
          @run="(cmd) => emit('run', cell.uid, cmd)"
          @run-spare="(cmd) => emit('runSpare', cell.uid, cmd)"
          @launch="(pick) => emit('launch', cell.uid, pick)"
          @close="emit('close', cell.uid)"
          @move="(dir) => emit('move', cell.uid, dir)"
          @status="(s) => emit('status', cell.uid, s)"
        />
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.stage {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--bg-deep);
}

.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  padding: 6px;
  box-sizing: border-box;
}

/* The focused cell grows via `transform: scale` (see `.focused`). That growth is a fraction
   of the cell's size, which for a wide/tall edge cell can push its edge past the viewport's
   `overflow:hidden` and clip the outermost characters. Inset the tiled grid by an amount that
   tracks the cell size on each axis — % of width horizontally, vh vertically — so the reserved
   room matches the scale at any window size and the zoom always stays on screen. (Scoped to the
   non-zoomed grid so the zoomed filmstrip keeps its own padding.) */
.stage:not(.zoomed) .grid {
  padding: calc(6px + 1.5vh) calc(6px + 1.6%);
}

/* Inert until a cell is zoomed. */
.zoom-main {
  display: none;
}

.zoom-main > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.stage.zoomed .zoom-main {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

/* List mode: text roster on the left, the expanded terminal on the right. */
.stage.zoomed.listmode {
  flex-direction: row;
}

.stage.zoomed.listmode .zoom-main {
  padding: 6px 6px 6px 0;
}

/* Keep the non-expanded cells mounted (connections + metadata stay live) but OFF the visible
   layout. A real off-screen box means xterm never fits to zero. */
.stage.zoomed.listmode .grid {
  position: absolute;
  left: -99999px;
  top: 0;
  width: 900px;
  height: 600px;
  display: block;
  overflow: hidden;
  padding: 0;
}

.stage.zoomed.listmode .grid > * {
  width: 900px;
  height: 600px;
}

/* Strip mode (toggle): the original filmstrip — expanded terminal on top, thumbnails below. */
.stage.zoomed:not(.listmode) {
  flex-direction: column;
}

.stage.zoomed:not(.listmode) .zoom-main {
  padding: 6px 6px 0;
}

.stage.zoomed:not(.listmode) .grid {
  flex: 0 0 150px;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
}

.stage.zoomed:not(.listmode) .grid > * {
  flex: 0 0 260px;
  height: 100%;
  min-width: 0;
}

/* The keyboard-focused cell lifts and grows slightly, in place — tiled grid only, so it never
   applies to a filmstrip thumbnail (.stage.zoomed) or a cell mid-FLIP. The transform doesn't change
   the cell's layout size, so xterm isn't refit and the PTY isn't resized. */
.stage:not(.zoomed) .grid > *:not(.flipping) {
  transition:
    transform 140ms ease,
    box-shadow 140ms ease;
}

.stage:not(.zoomed) .grid > .focused {
  transform: scale(1.03);
  z-index: 5;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
}

@media (prefers-reduced-motion: reduce) {
  .stage:not(.zoomed) .grid > *:not(.flipping) {
    transition: none;
  }
}

/* A second click landing mid-flight would measure a transformed cell and flip from the
   wrong rect, so the stage stays inert until the cell lands. */
.stage.flipping {
  pointer-events: none;
}

/* Restoring shrinks the cell from the overlay's rect back into its grid slot, so it
   starts out overflowing its siblings — it has to paint above them the whole way. */
.stage.flipping .flipping {
  z-index: 1;
}

/* Cells present in both layouts fly (they carry `.flipping`); the ones left here are the
   other tabs' cells, which appear in (or vanish from) the filmstrip with no counterpart to
   fly from, so they cross-fade instead. */
.stage.flipping .grid > *:not(.flipping) {
  animation: cell-in var(--flip-ms) var(--flip-ease);
}

.stage.flipping.zoomed .grid > *:not(.flipping) {
  animation-name: strip-in;
}

@keyframes cell-in {
  from {
    opacity: 0;
  }
}

@keyframes strip-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
</style>
