<script setup lang="ts">
// The server's copy of the layout, offered when this browser came up with none of its own (#3427).
import { useI18n } from "vue-i18n";
import { dismissOfferedCells, offeredCells, restoreOfferedCells } from "../composables/gridLayoutMirror";

const { t } = useI18n();
</script>

<template>
  <div
    v-if="offeredCells && offeredCells.length > 0"
    role="status"
    data-testid="grid-restore"
    class="fixed bottom-14 left-1/2 z-30 flex max-w-[calc(100vw-32px)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-border bg-panel px-4 py-2 font-sans text-[13px] text-fg shadow-lg"
  >
    <span class="material-symbols-outlined text-muted" aria-hidden="true">history</span>
    <span class="flex-auto">{{ t("gridRestore.message", { count: offeredCells.length }, offeredCells.length) }}</span>
    <button
      type="button"
      data-testid="grid-restore-go"
      class="h-[26px] cursor-pointer rounded-md border border-accent bg-base px-2.5 py-1 text-[12px] text-fg hover:bg-hover"
      @click="restoreOfferedCells"
    >
      {{ t("gridRestore.restore") }}
    </button>
    <button
      type="button"
      data-testid="grid-restore-dismiss"
      class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary hover:bg-hover hover:text-fg"
      @click="dismissOfferedCells"
    >
      {{ t("gridRestore.dismiss") }}
    </button>
  </div>
</template>
