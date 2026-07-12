<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch, nextTick } from "vue";
import TerminalCell from "./TerminalCell.vue";
import CommandCell from "./CommandCell.vue";
import LauncherCell from "./LauncherCell.vue";
import * as conn from "../composables/useTerminalConnections";
import { trackStyle, layoutForCount } from "./gridLayout";
import { flipKeyframes, FLIP_MS, FLIP_EASING } from "./cellFlip";
import { formatCwd } from "./cwdDisplay";
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
export interface CockpitRow {
  uid: number;
  cwd: string | null;
  agent: string;
  status: CellStatus;
  summary: string | null; // AI title
  prompt: string | null; // current user prompt
  response: string | null; // tail of the agent's latest reply
  fallback: string | null; // label when there's no prompt/summary yet (launcher/command name)
}
const STATUS_WORD: Record<CellStatus, string> = { working: "実行中", blocked: "入力待ち", done: "完了", idle: "待機" };
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
    flipping: uid === flippingUid.value,
    focused: uid === focusedUid.value && props.expandedUid === null && uid !== flippingUid.value,
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
    // swapping between two already-zoomed cells (cockpit list click) has no on-screen
    // source to fly from — the incoming cell sits off-screen in `.grid` — so skip the FLIP.
    if (to !== null && from !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = cellEl(uid);
    if (!el) return;
    const first = el.getBoundingClientRect();
    nextTick(() => flipCell(uid, first));
  },
);
</script>

<template>
  <div ref="stage" class="stage" :class="{ zoomed, listmode: listMode, flipping: flippingUid !== null }" :style="flipVars" @focusin="onFocusIn">
    <!-- toggle the zoomed side panel between the text roster and the old thumbnail strip. -->
    <button v-if="zoomed" type="button" class="view-toggle" :title="listMode ? 'サムネイル表示に切替' : 'リスト表示に切替'" @click="listMode = !listMode">
      {{ listMode ? "▤" : "☰" }}
    </button>
    <!-- Cockpit roster: a tall text row per cell (status / dir / summary / prompt / latest
         reply). Click a row to swap which terminal is enlarged. -->
    <aside v-if="zoomed && listMode" class="cockpit">
      <button
        v-for="row in listRows"
        :key="row.uid"
        type="button"
        :class="['cockpit-row', `st-${row.status}`, { active: row.uid === expandedUid }]"
        @click="row.uid !== expandedUid && emit('toggle-expand', row.uid)"
      >
        <span class="cockpit-head">
          <span class="cockpit-dot" :class="`st-${row.status}`" aria-hidden="true" />
          <span class="cockpit-badge" :class="`st-${row.status}`">{{ STATUS_WORD[row.status] }}</span>
          <span v-if="row.agent === 'codex'" class="cockpit-agent">codex</span>
          <span class="cockpit-dir">{{ formatCwd(row.cwd, home, 44) || "—" }}</span>
        </span>
        <span v-if="row.summary" class="cockpit-line"><b>要約</b> {{ row.summary }}</span>
        <span class="cockpit-line"><b>入力</b> {{ row.prompt || row.fallback || "—" }}</span>
        <span v-if="row.response" class="cockpit-line cockpit-response"><b>応答</b> {{ row.response }}</span>
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

.view-toggle {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 10;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}

.cockpit {
  flex: 0 0 360px;
  min-width: 0;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: var(--bg-deep);
}
.cockpit-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid transparent;
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text);
  cursor: pointer;
  font: inherit;
}
.cockpit-row:hover {
  filter: brightness(1.15);
}
.cockpit-row.active {
  border-color: #4a9eff;
  border-left-color: #4a9eff;
}
.cockpit-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cockpit-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #666;
}
.cockpit-badge {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: #333;
  color: #ddd;
}
.cockpit-dot.st-working,
.cockpit-badge.st-working {
  background: #4a9eff;
  color: #04121f;
}
.cockpit-dot.st-done,
.cockpit-badge.st-done {
  background: #22c55e;
  color: #04120a;
}
.cockpit-dot.st-blocked,
.cockpit-badge.st-blocked {
  background: #f59e0b;
  color: #1f1300;
}
.cockpit-agent {
  flex: 0 0 auto;
  font-size: 10px;
  color: #9ab;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
}
.cockpit-dir {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--text-dim, #9ab);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cockpit-line {
  font-size: 12px;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.cockpit-line b {
  font-size: 10px;
  font-weight: 700;
  color: #7a8aa0;
  margin-right: 4px;
}
.cockpit-response {
  color: var(--text-dim, #9ab);
  -webkit-line-clamp: 3;
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
  transform: scale(1.045);
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
