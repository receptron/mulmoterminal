<script setup lang="ts">
import TerminalCell from "./TerminalCell.vue";

// P0: a fixed 2x2 grid of independent terminal cells. Layout selection
// (3x2 / 4x2 / 3x3), per-cell dir, status, expand, and tabs come in later phases.
const CELL_COUNT = 4;
const cells = Array.from({ length: CELL_COUNT }, (_, i) => i);
</script>

<template>
  <div class="grid">
    <TerminalCell v-for="i in cells" :key="i" />
  </div>
</template>

<style scoped>
.grid {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: 6px;
  padding: 6px;
  background: #0f0f1e;
}
</style>
