<script setup lang="ts">
import { computed, ref, watch } from "vue";
import TerminalView from "./Terminal.vue";
import { formatCwd } from "./cwdDisplay";
import { shouldZoomOnHeaderClick } from "./cellHeaderZoom";
import type { CellStatus, CellLauncher } from "./gridTabs";

// A grid cell running a configured launch command (a plain shell, codex, any
// interactive program) instead of Claude. Unlike CommandCell this is PERSISTENT: it
// carries a session id and a durable connection (persistKey), so it survives page
// switches and reconnects — but it has no Claude hooks, so its status is only
// running (working) / exited (idle). `launcher.index` is the command's position in the
// configured launcher list (the server's allowlist); it runs in `cwd`.
const props = defineProps<{
  uid: number;
  expanded: boolean;
  // True while SOME cell in the grid is zoomed → this cell is a filmstrip thumbnail
  // (unless it's the zoomed one). Only then does a header-background click zoom it.
  zoomed?: boolean;
  launcher: CellLauncher;
  session: string | null;
  cwd: string | null;
  home: string | null;
  // Manual sort mode: show ◀▶ to swap this cell with its neighbour.
  reorderable?: boolean;
}>();
const emit = defineEmits<{
  (e: "toggle-expand" | "close"): void;
  (e: "move", dir: -1 | 1): void;
  // Report activity up so the grid can attention-sort in auto mode.
  (e: "status", value: CellStatus): void;
  // The server-assigned session id, so the parent persists it for reconnect.
  (e: "session", id: string): void;
}>();

// A filmstrip thumbnail zooms (switches to) this cell on a header-background click;
// in the normal grid the header is inert (only the ⤢ button zooms). Buttons keep their action.
const filmstrip = computed(() => !!props.zoomed && !props.expanded);
function onHeaderClick(event: MouseEvent) {
  if (shouldZoomOnHeaderClick(event.target, filmstrip.value)) emit("toggle-expand");
}

// connectKey bump re-launches after the process exits (relaunch button).
const connectKey = ref(0);
const finished = ref(false);

const dirDisplay = computed(() => formatCwd(props.cwd, props.home));
const target = computed(() => ({ index: props.launcher.index }));

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
    <div class="cell-header" :class="{ 'is-zoomable': filmstrip }" @click="onHeaderClick">
      <span class="cell-dot" :class="finished ? 'is-idle' : 'is-working'" :title="finished ? 'Exited' : 'Running…'" />
      <span v-if="dirDisplay" class="cell-dir" :title="cwd ?? ''"
        ><span class="cell-dir-path">{{ dirDisplay }}</span></span
      >
      <span class="cell-cmd">⌘ {{ launcher.label }}</span>
      <span class="cell-actions">
        <button v-if="reorderable" class="cell-btn" title="Move left" aria-label="Move launcher left" @click="emit('move', -1)">◀</button>
        <button v-if="reorderable" class="cell-btn" title="Move right" aria-label="Move launcher right" @click="emit('move', 1)">▶</button>
        <button v-if="finished" class="cell-btn" title="Relaunch" aria-label="Relaunch" @click="relaunch">↻</button>
        <button
          class="cell-btn"
          :title="expanded ? 'Restore' : 'Expand'"
          :aria-label="expanded ? 'Restore terminal' : 'Expand terminal'"
          @click="emit('toggle-expand')"
        >
          {{ expanded ? "⤡" : "⤢" }}
        </button>
        <button class="cell-btn cell-close" title="Close terminal" aria-label="Close terminal" @click="emit('close')">✕</button>
      </span>
    </div>
    <TerminalView
      class="cell-term"
      :persist-key="`cell-${uid}`"
      :session-id="session"
      :connect-key="connectKey"
      :cwd="cwd"
      :launcher="target"
      @session="onSession"
      @exit="onExit"
    />
  </div>
</template>

<style scoped>
.cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #1a1a2e;
  border: 1px solid #2a2a4e;
  border-radius: 6px;
  overflow: hidden;
}
.cell-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px;
  background: #16213e;
  border-bottom: 1px solid #2a2a4e;
}
/* Header background is a click target: zoom (switch to) this cell. */
.cell-header.is-zoomable {
  cursor: pointer;
}
.cell-header.is-zoomable:hover {
  background: #1c2a4e;
}
.cell-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #4a5070;
}
.cell-dot.is-working {
  background: #4a8cff;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
.cell-dir {
  flex: 0 1 auto;
  min-width: 16ch;
  max-width: 45%;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: #7f88ad;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.cell-dir-path {
  unicode-bidi: plaintext;
}
.cell-cmd {
  flex: 1 1 auto;
  min-width: 0;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  color: #c7cdf0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
}
.cell-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: none;
  background: transparent;
  color: #c7cdf0;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  border-radius: 6px;
}
.cell-btn:hover {
  background: #2a3b66;
  color: #e6e6f0;
}
.cell-close:hover {
  background: #3a2030;
  color: #ff6b6b;
}
.cell-term {
  flex: 1;
  min-height: 0;
}
</style>
