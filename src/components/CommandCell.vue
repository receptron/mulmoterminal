<script setup lang="ts">
import { computed, ref, watch } from "vue";
import TerminalView from "./Terminal.vue";
import { formatCwd } from "./cwdDisplay";
import type { CellStatus } from "./gridTabs";

// A grid cell that runs a `script.json` command (a cell launcher's Run) instead of
// a Claude session. Ephemeral: it has no session id and isn't persisted — a reload
// drops it. `command.index` is the script's position in `<command.cwd>/script.json`
// (the server resolves it); the command runs in `command.cwd`.
const props = defineProps<{
  expanded: boolean;
  command: { index: number; label: string; cwd: string | null };
  home: string | null;
  // Manual sort mode: show ◀▶ to swap this cell with its neighbour.
  reorderable?: boolean;
}>();
const emit = defineEmits<{
  (e: "toggle-expand" | "close"): void;
  // Swap this cell left (-1) or right (+1) in manual sort mode.
  (e: "move", dir: -1 | 1): void;
  // Report activity up so the grid can attention-sort in auto mode.
  (e: "status", value: CellStatus): void;
}>();

// connectKey forces Terminal.vue to (re)connect — bumped to re-run after exit.
const connectKey = ref(0);
const finished = ref(false);

const dirDisplay = computed(() => formatCwd(props.command.cwd, props.home));

// A running command counts as "working"; once it exits it's idle (never "waiting").
watch(finished, (done) => emit("status", done ? "idle" : "working"), { immediate: true });

function onExit() {
  finished.value = true;
}

function rerun() {
  finished.value = false;
  connectKey.value++;
}
</script>

<template>
  <div class="cell">
    <div class="cell-header">
      <span class="cell-dot" :class="finished ? 'is-idle' : 'is-working'" :title="finished ? 'Finished' : 'Running…'" />
      <span v-if="dirDisplay" class="cell-dir" :title="command.cwd ?? ''"
        ><span class="cell-dir-path">{{ dirDisplay }}</span></span
      >
      <span class="cell-cmd">▶ {{ command.label }}</span>
      <span class="cell-actions">
        <button v-if="reorderable" class="cell-btn" title="Move left" aria-label="Move command left" @click="emit('move', -1)">◀</button>
        <button v-if="reorderable" class="cell-btn" title="Move right" aria-label="Move command right" @click="emit('move', 1)">▶</button>
        <button v-if="finished" class="cell-btn" title="Re-run" aria-label="Re-run command" @click="rerun">↻</button>
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
    <TerminalView class="cell-term" :session-id="null" :connect-key="connectKey" :cwd="command.cwd" :command="command" @exit="onExit" />
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
  /* Floor the width at ~15 chars of the path so the current dir stays readable
     even on a narrow cell (1ch ≈ one monospace char; the leading … takes one). */
  min-width: 16ch;
  max-width: 45%;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: #7f88ad;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Truncate from the FRONT so the tail (the project dir) stays visible. */
  direction: rtl;
  /* Left-align so a short path hugs the dot instead of floating right (rtl). */
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
