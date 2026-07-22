<script setup lang="ts">
import { computed, ref, watch } from "vue";
import TerminalView from "./Terminal.vue";
import CellChromeButtons from "./CellChromeButtons.vue";
import { formatCwd } from "./cwdDisplay";
import { shouldZoomOnHeaderClick } from "./cellHeaderZoom";
import { isShellLauncher, type CellLauncher } from "./gridTabs";
import type { GridCellEmits, GridCellProps } from "./gridCell";

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
    // Manual sort mode: show ◀▶ to swap this cell with its neighbour.
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
  <div class="cell">
    <div class="cell-header" :class="{ 'is-zoomable': !expanded }" @click="onHeaderClick">
      <span class="cell-dot" :class="finished ? 'is-idle' : 'is-working'" :title="finished ? 'Exited' : 'Running…'" />
      <span v-if="dirDisplay" class="cell-dir" :title="cwd ?? ''"
        ><span class="cell-dir-path">{{ dirDisplay }}</span></span
      >
      <span class="cell-cmd">⌘ {{ launcher.label }}</span>
      <span class="cell-actions">
        <button v-if="reorderable" class="cell-btn" title="Move left" aria-label="Move launcher left" @click="emit('move', -1)">◀</button>
        <button v-if="reorderable" class="cell-btn" title="Move right" aria-label="Move launcher right" @click="emit('move', 1)">▶</button>
        <button v-if="finished" class="cell-btn" title="Relaunch" aria-label="Relaunch" @click="relaunch">↻</button>
        <CellChromeButtons :expanded="expanded" @toggle-expand="emit('toggle-expand')" @close="emit('close')" />
      </span>
    </div>
    <TerminalView
      class="cell-term"
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
</template>

<style scoped src="./cellChromeBase.css"></style>
<style scoped src="./cellChrome.css"></style>
