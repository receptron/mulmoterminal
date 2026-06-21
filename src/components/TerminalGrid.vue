<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import TerminalCell from "./TerminalCell.vue";
import { trackStyle, layoutForCount } from "./gridLayout";
import type { Cell } from "./gridTabs";
import type { CwdPreset } from "./presets";

// Renders ONE page of the grid (≤9 cells), auto-sized to the cell count. The page
// is fully controlled by GridView: `cells` is the page's slice and `expandedUid`
// the zoomed cell (if it is on this page); every change is emitted up by uid.
// Expanding a cell switches to a filmstrip — the zoomed cell (teleported to the
// overlay) fills the top, the rest line up in a scrollable strip below.
const props = defineProps<{ cells: Cell[]; expandedUid: number | null; defaultCwd: string | null; presets: CwdPreset[]; home: string | null }>();
const emit = defineEmits<{
  (e: "session" | "cwd", uid: number, value: string): void;
  (e: "close" | "toggle-expand", uid: number): void;
}>();

const gridStyle = computed(() => trackStyle(layoutForCount(props.cells.length), null));

// The zoomed cell is teleported up here; the target must exist before it moves, so
// hold off until mounted (covers a reload that restores a zoom).
const zoomMain = ref<HTMLElement | null>(null);
const mounted = ref(false);
onMounted(() => (mounted.value = true));
const zoomed = computed(() => props.expandedUid !== null && mounted.value);
</script>

<template>
  <div class="stage" :class="{ zoomed }">
    <div ref="zoomMain" class="zoom-main" />
    <div class="grid" :style="gridStyle">
      <Teleport v-for="cell in cells" :key="cell.uid" :to="zoomMain" :disabled="!(zoomed && cell.uid === expandedUid)">
        <TerminalCell
          :expanded="cell.uid === expandedUid"
          :initial-session-id="cell.session"
          :initial-cwd="cell.cwd"
          :default-cwd="defaultCwd"
          :presets="presets"
          :home="home"
          @toggle-expand="emit('toggle-expand', cell.uid)"
          @session="(id) => emit('session', cell.uid, id)"
          @cwd="(c) => emit('cwd', cell.uid, c)"
          @close="() => emit('close', cell.uid)"
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
  background: #0f0f1e;
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
</style>
