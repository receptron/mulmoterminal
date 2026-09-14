<script setup lang="ts">
import { computed, ref, watch } from "vue";
import TerminalView from "./Terminal.vue";
import CellShell from "./CellShell.vue";
import { cellShellEvents } from "./cellChromeBinding";
import { isShellLauncher, type CellLauncher } from "./gridTabs";
import type { GridCellEmits, GridCellProps } from "./gridCell";
import { CELL_BTN, CELL_TERM } from "./cellChromeClasses";

// A grid cell running a configured launch command — any interactive program, run exactly as the
// user wrote it and never inspected. Unlike CommandCell this is PERSISTENT: it
// carries a session id and a durable connection (persistKey), so it survives page
// switches and reconnects — but it reports no activity of its own, so its status is only
// running (working) / exited (idle). `launcher.index` is the command's position in the
// configured launcher list (the server's allowlist); it runs in `cwd`.
//
// The frame, header and chrome buttons come from CellShell, which CommandCell shares.
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

const shellEvents = cellShellEvents(emit);

// connectKey bump re-launches after the process exits (relaunch button).
const connectKey = ref(0);
const finished = ref(false);

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
  <CellShell
    :expanded="expanded"
    :files-open="filesOpen"
    :right-pane="rightPane"
    :canvas-available="canvasAvailable"
    :collections-available="collectionsAvailable"
    :home="home"
    :cwd="cwd"
    :default-cwd="defaultCwd"
    :finished="finished"
    idle-title="Exited"
    icon="rocket_launch"
    :label="launcher.label"
    move-noun="launcher"
    :reorderable="reorderable"
    v-on="shellEvents"
  >
    <template #actions>
      <button v-if="finished" class="cell-btn" :class="CELL_BTN" title="Relaunch" aria-label="Relaunch" @click="relaunch">
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
      </button>
    </template>
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
  </CellShell>
</template>
