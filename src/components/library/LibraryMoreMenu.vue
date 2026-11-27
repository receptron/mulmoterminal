<script setup lang="ts">
// The reader's `more_horiz` menu: everything but an item's one prominent action (#3327). Its items
// are the slot's, each a `role=menuitem` button; the owner closes it with `close()` when one is picked.
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useOverlayVisible } from "../../composables/overlayVisibility";

const { t } = useI18n();
const menuOpen = ref(false);
const menu = ref<HTMLElement | null>(null);
// While the menu is open, Esc and a click elsewhere close IT. Esc is caught on the way down
// (capture), before the Library's own window-level Esc would close the whole screen.
const menuButton = ref<HTMLButtonElement | null>(null);
function onMenuKey(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  event.preventDefault();
  menuOpen.value = false;
  menuButton.value?.focus(); // back where the keyboard came from, not to the page
}
/** The menu's own keys: the arrows move between its items, and Tab leaves it (closing it). */
function onMenuItemsKey(event: KeyboardEvent): void {
  const items = [...(menu.value?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  const at = items.findIndex((item) => item === document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation(); // the Library's arrows move its list, not this menu
    const next = (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  } else if (event.key === "Tab") {
    menuOpen.value = false;
  }
}
function onMenuFocusOut(event: FocusEvent): void {
  if (event.relatedTarget instanceof Node && menu.value?.contains(event.relatedTarget)) return;
  if (event.relatedTarget !== null) menuOpen.value = false; // focus went somewhere else on the page
}

function onOutsidePointer(event: PointerEvent): void {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return;
  menuOpen.value = false;
}
watch(menuOpen, async (open) => {
  window.removeEventListener("keydown", onMenuKey, true);
  window.removeEventListener("pointerdown", onOutsidePointer, true);
  if (!open) return;
  window.addEventListener("keydown", onMenuKey, true);
  window.addEventListener("pointerdown", onOutsidePointer, true);
  await nextTick();
  menu.value?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onMenuKey, true);
  window.removeEventListener("pointerdown", onOutsidePointer, true);
});

function close(): void {
  menuOpen.value = false;
}
// The screen is hidden, not unmounted, when it closes: a menu left open would keep the keys.
watch(useOverlayVisible(), (shown) => {
  if (!shown) close();
});
defineExpose({ close });
</script>

<template>
  <div ref="menu" class="relative mr-auto">
    <button
      ref="menuButton"
      type="button"
      data-testid="library-more-actions"
      class="flex cursor-pointer items-center rounded border-0 bg-transparent p-1 text-secondary hover:bg-hover hover:text-fg"
      :aria-label="t('libraryView.moreActions')"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
      @click="menuOpen = !menuOpen"
    >
      <span class="material-symbols-outlined text-[20px]">more_horiz</span>
    </button>
    <div
      v-if="menuOpen"
      role="menu"
      class="absolute bottom-full left-0 mb-1 min-w-[12rem] rounded-[6px] border border-border bg-panel py-1 shadow-lg"
      @keydown="onMenuItemsKey"
      @focusout="onMenuFocusOut"
    >
      <slot />
    </div>
  </div>
</template>
