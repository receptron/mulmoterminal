<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import TerminalCell from "./TerminalCell.vue";
import CommandCell from "./CommandCell.vue";
import LauncherCell from "./LauncherCell.vue";
import { trackStyle, layoutForCount } from "./gridLayout";
import { flipKeyframes, FLIP_MS, FLIP_EASING } from "./cellFlip";
import type { Cell, CellStatus } from "./gridTabs";
import type { RunCommand } from "./runCommand";
import type { CwdPreset } from "./presets";
import type { Launcher, LaunchPick } from "./launchers";

// Renders the grid, auto-sized to the cell count, fully controlled by GridView:
// `cells` is the active page's slice (≤9) when nothing is zoomed, and `expandedUid`
// the zoomed cell; every change is emitted up by uid.
// Expanding a cell switches to a filmstrip — the zoomed cell (teleported to the
// overlay) fills the top, the rest line up in a scrollable strip below. While
// zoomed, GridView passes EVERY cell (all tabs), so the strip shows them all live.
// A cell carrying a `command` renders as a CommandCell (a running script.json
// command) instead of the Claude launcher/terminal.
const props = defineProps<{
  cells: Cell[];
  expandedUid: number | null;
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
  (e: "run", uid: number, command: RunCommand): void;
  (e: "runSpare", command: RunCommand): void;
  (e: "launch", uid: number, pick: LaunchPick): void;
  (e: "move", uid: number, dir: -1 | 1): void;
  (e: "status", uid: number, value: CellStatus): void;
  (e: "agent", uid: number, value: "claude" | "codex"): void;
  // Shared preset list events — uid-less since they mutate the one config list.
  (e: "record-cwd" | "remove-preset", value: string): void;
}>();

const gridStyle = computed(() => trackStyle(layoutForCount(props.cells.length)));
// Hand the flip's timing to the stylesheet so the fade under it can't drift out of sync.
const flipVars = { "--flip-ms": `${FLIP_MS}ms`, "--flip-ease": FLIP_EASING };

// The zoomed cell is teleported up here; the target must exist before it moves, so
// hold off until mounted (covers a reload that restores a zoom).
const zoomMain = ref<HTMLElement | null>(null);
const mounted = ref(false);
onMounted(() => (mounted.value = true));
const zoomed = computed(() => props.expandedUid !== null && mounted.value);

const stage = ref<HTMLElement | null>(null);
// The cell currently flying between slots. Also gates the stylesheet: the cells it
// leaves behind fade in under it, and the stage stops taking clicks until it lands.
const flippingUid = ref<number | null>(null);
let running: Animation | null = null;

const cellEl = (uid: number) => stage.value?.querySelector<HTMLElement>(`[data-uid="${uid}"]`) ?? null;

function flipCell(uid: number, first: DOMRect) {
  const el = cellEl(uid);
  const frames = el && flipKeyframes(first, el.getBoundingClientRect());
  if (!el || !frames) return;
  running?.cancel();
  flippingUid.value = uid;
  const anim = el.animate(frames, { duration: FLIP_MS, easing: FLIP_EASING });
  running = anim;
  const settle = () => {
    // A newer flip already took over — it owns `running` and the class now.
    if (running !== anim) return;
    running = null;
    flippingUid.value = null;
  };
  anim.finished.then(settle, settle); // cancel() rejects, and a cancelled flip still settles
}

// Pre-flush, so the cell is still in the slot it is leaving when we measure it. Zooming
// straight from one cell to another reports `to` — the arriving cell is the one to fly.
watch(
  () => props.expandedUid,
  (to, from) => {
    const uid = to ?? from;
    if (uid === null || uid === undefined) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = cellEl(uid);
    if (!el) return;
    const first = el.getBoundingClientRect();
    nextTick(() => flipCell(uid, first));
  },
);
</script>

<template>
  <div ref="stage" class="stage" :class="{ zoomed, flipping: flippingUid !== null }" :style="flipVars">
    <div ref="zoomMain" class="zoom-main" />
    <div class="grid" :style="gridStyle">
      <Teleport v-for="cell in cells" :key="cell.uid" :to="zoomMain" :disabled="!(zoomed && cell.uid === expandedUid)">
        <CommandCell
          v-if="cell.command"
          :data-uid="cell.uid"
          :class="{ flipping: cell.uid === flippingUid }"
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
          :class="{ flipping: cell.uid === flippingUid }"
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
          :class="{ flipping: cell.uid === flippingUid }"
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
          @run-spare="(cmd) => emit('runSpare', cmd)"
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

/* Inert until a cell is zoomed. */
.zoom-main {
  display: none;
}

/* Filmstrip: the zoomed cell (teleported here) fills the top. */
.stage.zoomed .zoom-main {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding: 6px 6px 0;
}
.zoom-main > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* The grid itself becomes the bottom strip: the remaining cells in a single row
   that scrolls horizontally when they overflow. */
.stage.zoomed .grid {
  flex: 0 0 150px;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
}
.stage.zoomed .grid > * {
  flex: 0 0 260px;
  height: 100%;
  min-width: 0;
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

/* Only the zoomed cell has two rects to fly between. The cells it leaves behind are
   arriving in (or vanishing from) a strip that has no counterpart in the other layout,
   so they cross-fade under it instead. */
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
