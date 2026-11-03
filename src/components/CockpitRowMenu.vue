<script setup lang="ts">
// The ⋮ action menu on a cockpit roster row (#707, #2299). Top: mark unread / read. Middle: move
// up / down, in manual sort only. Bottom: set aside, close. Unread and close sit at opposite ends
// on purpose — a slip onto the neighbouring item must not end a session.
//
// It opens from the ⋮ or, through `at`, at the pointer of a right-click on the row. The dropdown is
// teleported to <body> and fixed-positioned: the roster row is overflow-hidden inside an
// overflow-y-auto aside, so a menu left in place would be clipped. `@click.stop` on the trigger +
// menu keeps a click from also swapping which terminal the row enlarges, and a roster scroll closes
// it (the fixed panel would otherwise detach from its row). Open, it takes the focus for its first
// item and the arrow keys walk the items as in the other menus (#3257); closed, the focus goes back
// to the ⋮.
import { ref, watch, nextTick, onBeforeUnmount, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { fitMenu, type AttentionAction, type MenuPoint } from "./rowMenu";
import { menuKeydown } from "./menuKeyboard";

const props = defineProps<{
  canUp: boolean;
  canDown: boolean;
  reorderable: boolean;
  attention: AttentionAction | null;
  parkable: boolean;
  parked: boolean;
  /** A right-click's pointer position; a new value opens the menu there. */
  at?: MenuPoint | null;
  /** Which way the list runs: the roster is a column, the filmstrip a row, and "up" in a row of
   *  thumbnails would name a direction the cells do not move in. */
  axis?: "vertical" | "horizontal";
}>();
const emit = defineEmits<{
  move: [dir: -1 | 1];
  attention: [waiting: boolean];
  park: [on: boolean];
  close: [];
  /** The menu closed, so a pending `at` can be dropped. */
  dismissed: [];
}>();

const { t } = useI18n();

// The app has no Tailwind preflight, so a <button> keeps the browser's border, fill and text colour
// unless each is set here.
const ITEM_BASE = "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left font-sans text-[13px]";
const ITEM_CLASS = `${ITEM_BASE} text-fg enabled:hover:bg-hover disabled:cursor-default disabled:text-dim disabled:opacity-50`;
const CLOSE_ITEM_CLASS = `${ITEM_BASE} text-err-text hover:bg-[var(--err-hover-bg)]`;
const ICON_CLASS = "material-symbols-outlined w-3.5 text-center text-[#4a9eff]";
const DIVIDER_CLASS = "my-1.5 border-t border-border";

const trigger = useTemplateRef<HTMLElement>("trigger");
const menu = useTemplateRef<HTMLElement>("menu");
const open = ref(false);
const pos = ref<MenuPoint>({ top: 0, left: 0 });
// A disabled direction is skipped, not landed on.
const ITEM_SELECTOR = "[role=menuitem]:not(:disabled)";
const items = (): HTMLElement[] => [...(menu.value?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];

const belowTrigger = (): MenuPoint => {
  const rect = trigger.value?.getBoundingClientRect();
  return rect ? { top: rect.bottom + 4, left: rect.right } : { top: 0, left: 0 };
};
// Placed once it has rendered, since only then is its size known. From the ⋮ it hangs right-aligned
// under the button; from a right-click it starts at the pointer.
async function place(want: MenuPoint, alignRight: boolean): Promise<void> {
  pos.value = want;
  await nextTick();
  const box = menu.value?.getBoundingClientRect();
  if (!box) return;
  const left = alignRight ? want.left - box.width : want.left;
  pos.value = fitMenu({ top: want.top, left }, box, { width: window.innerWidth, height: window.innerHeight });
  items()[0]?.focus({ preventScroll: true });
}
function onOutside(event: PointerEvent) {
  const target = event.target instanceof Node ? event.target : null;
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) close();
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}
function onMenuKeydown(event: KeyboardEvent) {
  menuKeydown(event, items(), close);
}
function openMenu(want: MenuPoint, alignRight: boolean) {
  if (!open.value) {
    window.addEventListener("pointerdown", onOutside);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("scroll", close, true);
  }
  open.value = true;
  void place(want, alignRight);
}
function close() {
  if (!open.value) return;
  if (menu.value?.contains(document.activeElement)) trigger.value?.focus({ preventScroll: true });
  open.value = false;
  window.removeEventListener("pointerdown", onOutside);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("scroll", close, true);
  emit("dismissed");
}
function toggle() {
  if (open.value) close();
  else openMenu(belowTrigger(), true);
}
watch(
  () => props.at,
  (point) => {
    if (point) openMenu(point, false);
  },
);
// Every item closes the menu after acting, so each is one line in the template.
function pick(act: () => void) {
  act();
  close();
}
onBeforeUnmount(close);
</script>

<template>
  <div class="relative flex-none" @click.stop>
    <button
      ref="trigger"
      type="button"
      data-testid="cockpit-row-menu"
      class="grid h-[22px] w-[22px] place-items-center rounded-md border border-transparent text-[16px] leading-none text-dim hover:border-border hover:bg-panel hover:text-fg"
      :class="{ 'border-border bg-panel text-fg': open }"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="t('rowMenu.trigger')"
      :data-tip="t('rowMenu.title')"
      @click="toggle"
    >
      <span class="material-symbols-outlined" aria-hidden="true">more_vert</span>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        data-testid="cockpit-row-menu-panel"
        role="menu"
        class="fixed z-[60] min-w-[150px] rounded-lg border border-border bg-panel p-1.5 text-fg shadow-xl"
        :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown="onMenuKeydown"
      >
        <template v-if="attention">
          <button
            v-if="attention === 'unread'"
            type="button"
            role="menuitem"
            data-testid="row-mark-unread"
            :class="ITEM_CLASS"
            :data-tip="t('rowMenu.markUnreadHint')"
            @click="pick(() => emit('attention', true))"
          >
            <span :class="ICON_CLASS" aria-hidden="true">mark_chat_unread</span> {{ t("rowMenu.markUnread") }}
          </button>
          <button v-else type="button" role="menuitem" data-testid="row-mark-read" :class="ITEM_CLASS" @click="pick(() => emit('attention', false))">
            <span :class="ICON_CLASS" aria-hidden="true">mark_chat_read</span> {{ t("rowMenu.markRead") }}
          </button>
          <div :class="DIVIDER_CLASS" role="separator" />
        </template>
        <template v-if="reorderable">
          <button type="button" role="menuitem" data-testid="reorder-up" :class="ITEM_CLASS" :disabled="!canUp" @click="pick(() => emit('move', -1))">
            <span :class="ICON_CLASS" aria-hidden="true">{{ axis === "horizontal" ? "arrow_back" : "arrow_upward" }}</span>
            {{ axis === "horizontal" ? t("rowMenu.moveLeft") : t("rowMenu.moveUp") }}
          </button>
          <button type="button" role="menuitem" data-testid="reorder-down" :class="ITEM_CLASS" :disabled="!canDown" @click="pick(() => emit('move', 1))">
            <span :class="ICON_CLASS" aria-hidden="true">{{ axis === "horizontal" ? "arrow_forward" : "arrow_downward" }}</span>
            {{ axis === "horizontal" ? t("rowMenu.moveRight") : t("rowMenu.moveDown") }}
          </button>
          <div :class="DIVIDER_CLASS" role="separator" />
        </template>
        <button v-if="parkable" type="button" role="menuitem" data-testid="row-park" :class="ITEM_CLASS" @click="pick(() => emit('park', !parked))">
          <span :class="ICON_CLASS" aria-hidden="true">hotel</span>
          {{ parked ? t("rowMenu.wake") : t("rowMenu.setAside") }}
        </button>
        <button type="button" role="menuitem" data-testid="row-close" :class="CLOSE_ITEM_CLASS" @click="pick(() => emit('close'))">
          <span class="material-symbols-outlined w-3.5 text-center" aria-hidden="true">power_settings_new</span> {{ t("rowMenu.close") }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
