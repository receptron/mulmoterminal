<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import DirBadge from "./DirBadge.vue";
import { useDirConfig } from "../composables/useDirConfig";
import TerminalView from "./Terminal.vue";
import CellChromeButtons from "./CellChromeButtons.vue";
import { formatCwd } from "./cwdDisplay";
import { shouldZoomOnHeaderClick } from "./cellHeaderZoom";
import { isShellLauncher, type CellLauncher } from "./gridTabs";
import type { GridCellEmits, GridCellProps } from "./gridCell";
import {
  CELL_ACTIONS,
  CELL_BTN,
  CELL_CMD,
  CELL_DIR,
  CELL_DIR_PATH,
  CELL_DOT,
  CELL_DOT_IDLE,
  CELL_DOT_WORKING,
  CELL_FRAME,
  CELL_INNER,
  CELL_HEADER,
  CELL_HEADER_ZOOMABLE,
  CELL_TERM,
} from "./cellChromeClasses";

// A grid cell running a configured launch command (a plain shell, codex, any
// interactive program) instead of Claude. Unlike CommandCell this is PERSISTENT: it
// carries a session id and a durable connection (persistKey), so it survives page
// switches and reconnects — but it has no Claude hooks, so its status is only
// running (working) / exited (idle). `launcher.index` is the command's position in the
// configured launcher list (the server's allowlist); it runs in `cwd`.
const props = defineProps<
  GridCellProps & {
    uid: number;
    launcher: CellLauncher;
    session: string | null;
    cwd: string | null;
    // Manual sort mode: show move buttons to swap this cell with its neighbour.
    reorderable?: boolean;
  }
>();
const emit = defineEmits<
  GridCellEmits & {
    // The server-assigned session id, so the parent persists it for reconnect.
    (e: "session", id: string): void;
  }
>();

// Clicking the header background zooms (switches to) this cell, except the already-
// expanded one. Buttons keep their action.
function onHeaderClick(event: MouseEvent) {
  if (shouldZoomOnHeaderClick(event.target, props.expanded)) emit("toggle-expand");
}

// connectKey bump re-launches after the process exits (relaunch button).
const connectKey = ref(0);
const finished = ref(false);

// The name badge is CHROME — this cell's own header, not the terminal canvas (#914). The
// canvas side resolves itself inside Terminal.vue (#911); this is the other half of that line.
const { config: dirConfig } = useDirConfig(toRef(props, "cwd"));

const dirDisplay = computed(() => formatCwd(props.cwd, props.home));
const target = computed(() => (isShellLauncher(props.launcher) ? { shell: true as const } : { index: props.launcher.index }));

// Running counts as "working"; once the process exits it's idle (never "waiting").
watch(finished, (done) => emit("status", done ? "idle" : "working"), { immediate: true });

function onSession(id: string) {
  emit("session", id);
}
function onExit() {
  finished.value = true;
}
function relaunch() {
  finished.value = false;
  connectKey.value++;
}
</script>

<template>
  <div class="cell" :class="CELL_FRAME">
    <div :class="CELL_INNER">
      <div class="cell-header" :class="[CELL_HEADER, expanded ? '' : `is-zoomable ${CELL_HEADER_ZOOMABLE}`]" @click="onHeaderClick">
        <span
          class="cell-dot"
          :class="[CELL_DOT, finished ? `is-idle ${CELL_DOT_IDLE}` : `is-working ${CELL_DOT_WORKING}`]"
          :title="finished ? 'Exited' : 'Running…'"
        />
        <span v-if="dirDisplay" class="cell-dir" :class="CELL_DIR" :title="cwd ?? ''"
          ><span class="cell-dir-path" :class="CELL_DIR_PATH">{{ dirDisplay }}</span></span
        >
        <DirBadge :name="dirConfig.name" :color="dirConfig.badgeColor" />
        <span class="cell-cmd" :class="CELL_CMD"><span class="material-symbols-outlined" aria-hidden="true">rocket_launch</span> {{ launcher.label }}</span>
        <span class="cell-actions" :class="CELL_ACTIONS">
          <button v-if="reorderable" class="cell-btn" :class="CELL_BTN" title="Move left" aria-label="Move launcher left" @click="emit('move', -1)">
            <span class="material-symbols-outlined" aria-hidden="true">chevron_left</span>
          </button>
          <button v-if="reorderable" class="cell-btn" :class="CELL_BTN" title="Move right" aria-label="Move launcher right" @click="emit('move', 1)">
            <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </button>
          <button v-if="finished" class="cell-btn" :class="CELL_BTN" title="Relaunch" aria-label="Relaunch" @click="relaunch">
            <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
          </button>
          <CellChromeButtons
            :expanded="expanded"
            :files-open="filesOpen"
            :right-pane="rightPane"
            :canvas-available="canvasAvailable"
            @toggle-expand="emit('toggle-expand')"
            @toggle-files="emit('toggle-files')"
            @toggle-canvas="emit('toggle-canvas')"
            @toggle-tools="emit('toggle-tools')"
            @close="emit('close')"
          />
        </span>
      </div>
      <TerminalView
        class="cell-term"
        :class="CELL_TERM"
        :persist-key="`cell-${uid}`"
        :session-id="session"
        :connect-key="connectKey"
        :cwd="cwd"
        :launcher="target"
        :expanded="expanded"
        :zoomed="zoomed"
        @session="onSession"
        @exit="onExit"
      />
    </div>
  </div>
</template>
