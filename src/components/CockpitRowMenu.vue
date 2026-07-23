<script setup lang="ts">
// The ⋮ reorder menu on a cockpit roster row (grid manual sort). Sits at the right of the row
// header and offers up/down moves, disabled at the ends. Only the move is here — the actual
// reorder is the parent's existing moveCell, driven off the emitted direction.
//
// The dropdown is teleported to <body> and fixed-positioned under the ⋮: the roster row is
// overflow-hidden inside an overflow-y-auto aside, so a menu left in place would be clipped.
// `@click.stop` on the trigger + menu keeps a click from also toggling which terminal the row
// expands, and a roster scroll closes it (the fixed panel would otherwise detach from the ⋮).
import { ref, onBeforeUnmount, useTemplateRef } from "vue";

defineProps<{ canUp: boolean; canDown: boolean }>();
const emit = defineEmits<{ move: [dir: -1 | 1] }>();

const trigger = useTemplateRef<HTMLElement>("trigger");
const menu = useTemplateRef<HTMLElement>("menu");
const open = ref(false);
const pos = ref({ top: 0, left: 0 });
const MENU_WIDTH_PX = 152;

function place() {
  const rect = trigger.value?.getBoundingClientRect();
  if (rect) pos.value = { top: Math.round(rect.bottom + 4), left: Math.round(Math.max(8, rect.right - MENU_WIDTH_PX)) };
}
function onOutside(event: PointerEvent) {
  const target = event.target instanceof Node ? event.target : null;
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) close();
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}
function openMenu() {
  place();
  open.value = true;
  window.addEventListener("pointerdown", onOutside);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("scroll", close, true); // a roster scroll slides the ⋮ out from under the menu
}
function close() {
  if (!open.value) return;
  open.value = false;
  window.removeEventListener("pointerdown", onOutside);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("scroll", close, true);
}
function toggle() {
  if (open.value) close();
  else openMenu();
}
function pick(dir: -1 | 1) {
  emit("move", dir);
  close();
}
onBeforeUnmount(close);
</script>

<template>
  <div class="relative flex-none" @click.stop>
    <button
      ref="trigger"
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
    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        data-testid="cockpit-reorder-menu"
        role="menu"
        class="fixed z-[60] min-w-[150px] rounded-lg border border-border bg-panel p-1.5 text-fg shadow-xl"
        :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
        @click.stop
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
    </Teleport>
  </div>
</template>
