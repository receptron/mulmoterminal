<script setup lang="ts">
// The ⋮ reorder menu on a cockpit roster row (grid manual sort). Sits at the right of the row
// header and offers up/down moves, disabled at the ends. Only the move is here — the actual
// reorder is the parent's existing moveCell, driven off the emitted direction. `@click.stop` on
// the root keeps a click on the menu from also toggling which terminal the row expands.
import { useTemplateRef } from "vue";
import { useDropdownMenu } from "../composables/useDropdownMenu";

defineProps<{ canUp: boolean; canDown: boolean }>();
const emit = defineEmits<{ move: [dir: -1 | 1] }>();

const root = useTemplateRef<HTMLElement>("root");
const { open, close, toggle } = useDropdownMenu(root);

function pick(dir: -1 | 1) {
  emit("move", dir);
  close();
}
</script>

<template>
  <div ref="root" class="relative flex-none" @click.stop>
    <button
      type="button"
      data-testid="cockpit-reorder"
      class="grid h-[22px] w-[22px] place-items-center rounded-md border border-transparent text-[16px] leading-none text-dim hover:border-border hover:bg-panel hover:text-fg"
      :class="{ 'border-border bg-panel text-fg': open }"
      :aria-expanded="open"
      aria-haspopup="menu"
      aria-label="このセルを並べ替え"
      title="並べ替え"
      @click="toggle"
    >
      ⋮
    </button>
    <div
      v-if="open"
      data-testid="cockpit-reorder-menu"
      role="menu"
      class="absolute right-0 top-[26px] z-20 min-w-[150px] rounded-lg border border-border bg-panel p-1.5 text-fg shadow-xl"
    >
      <button
        type="button"
        role="menuitem"
        data-testid="reorder-up"
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] enabled:hover:bg-[#29344a] disabled:cursor-default disabled:text-dim disabled:opacity-50"
        :disabled="!canUp"
        @click="pick(-1)"
      >
        <span class="w-3.5 text-center font-mono text-[#4a9eff]">↑</span> 上へ移動
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="reorder-down"
        class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] enabled:hover:bg-[#29344a] disabled:cursor-default disabled:text-dim disabled:opacity-50"
        :disabled="!canDown"
        @click="pick(1)"
      >
        <span class="w-3.5 text-center font-mono text-[#4a9eff]">↓</span> 下へ移動
      </button>
    </div>
  </div>
</template>
