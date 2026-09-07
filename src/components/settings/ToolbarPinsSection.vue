<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useShortcuts } from "../../composables/useShortcuts";
import { toolbarPinKeys, saveToolbarPins } from "../../composables/toolbarPins";
import { MAX_TOOLBAR_PINS, toolbarPinKey, toggleToolbarPin } from "../../../common/toolbarPins";
import type { Shortcut } from "../../../common/shortcuts";

// Which of the pinned favourites get a permanent button on the toolbar (#1984). A checklist rather
// than an editor: the entries already exist — pinning is done in Collections, where the thing being
// pinned is on screen — so the only question here is which few are worth the row's width.
const { t } = useI18n();
const { shortcuts } = useShortcuts();

const promoted = (pin: Shortcut): boolean => toolbarPinKeys.value.includes(toolbarPinKey(pin));
const full = computed(() => toolbarPinKeys.value.length >= MAX_TOOLBAR_PINS);

// The browser has already flipped the box by the time this runs, and neither a refused save nor a
// change the cap declined moves the stored list — so the box is put back where the list says,
// rather than left showing a state the host never took.
async function onToggle(e: Event, pin: Shortcut): Promise<void> {
  if (!(e.target instanceof HTMLInputElement)) return;
  const input = e.target;
  const next = toggleToolbarPin(toolbarPinKeys.value, toolbarPinKey(pin), input.checked);
  if (next === toolbarPinKeys.value || !(await saveToolbarPins(next))) input.checked = promoted(pin);
}
</script>

<template>
  <p class="mb-2 mt-1.5 text-[12px] text-dim">{{ t("settings.toolbarPins.intro", { max: MAX_TOOLBAR_PINS }) }}</p>
  <p v-if="!shortcuts.length" class="mb-2 text-[12px] text-dim">{{ t("settings.toolbarPins.empty") }}</p>
  <label v-for="pin in shortcuts" :key="toolbarPinKey(pin)" class="mb-1.5 flex cursor-pointer items-center gap-2">
    <input
      type="checkbox"
      class="cursor-pointer disabled:cursor-not-allowed"
      :checked="promoted(pin)"
      :disabled="full && !promoted(pin)"
      :aria-label="pin.title"
      @change="(e) => void onToggle(e, pin)"
    />
    <span class="material-symbols-outlined text-[16px] leading-none text-muted" aria-hidden="true">{{ pin.icon || "bookmark" }}</span>
    <span class="text-[13px]">{{ pin.title }}</span>
  </label>
  <p v-if="shortcuts.length && full" class="mt-2 text-[12px] text-dim">{{ t("settings.toolbarPins.full", { max: MAX_TOOLBAR_PINS }) }}</p>
</template>
