<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useShortcuts } from "../../composables/useShortcuts";
import { toolbarPinKeys, promoteToolbarPin } from "../../composables/toolbarPins";
import { MAX_TOOLBAR_PINS, toolbarPinKey } from "../../../common/toolbarPins";
import type { Shortcut } from "../../../common/shortcuts";

// Which of the pinned favourites get a permanent button on the toolbar (#1984). A checklist rather
// than an editor: the entries already exist — pinning is done in Collections, where the thing being
// pinned is on screen — so the only question here is which few are worth the row's width.
const { t } = useI18n();
const { shortcuts, loadError, load } = useShortcuts();

// Re-read on open. The store caches its first successful `/api/shortcuts` for the life of the page,
// and the file is shared with MulmoClaude, so a session open for an hour can be offering a list the
// disk no longer has (Codex, PR #1991).
//
// It is a FRESHNESS measure and nothing more. Saving cannot delete a key the user did not untick
// (`nextToolbarPins`), so a list that arrives late or not at all costs an out-of-date row and a cap
// that may be off by one — never a promotion. That is why this pane is usable while the read is out
// rather than disabled behind it: an earlier version gated every tick on the read landing, and the
// gate only existed to protect a prune that no longer happens.
const refreshed = load(true).catch(() => undefined); // it answers rather than throws; a rejection must not reach a DOM handler

const live = computed(() => shortcuts.value.map(toolbarPinKey));
// What is promoted AND still exists. The cap is counted on this rather than on the stored list: a
// key whose pin was removed is not offered here, so counting it would fill the five slots with
// rows the user cannot see to untick and lock the section (Codex, PR #1991). Such a key is dropped
// by the next save — `nextToolbarPins` prunes what `live` no longer holds.
const promotedKeys = computed(() => toolbarPinKeys.value.filter((key) => live.value.includes(key)));
const promoted = (pin: Shortcut): boolean => promotedKeys.value.includes(toolbarPinKey(pin));
const full = computed(() => promotedKeys.value.length >= MAX_TOOLBAR_PINS);

// The browser has already flipped the box by the time this runs, and neither a refused save nor a
// change the cap declined moves the stored list — so the box is put back where the list says,
// rather than left showing a state the host never took.
async function onToggle(e: Event, pin: Shortcut): Promise<void> {
  if (!(e.target instanceof HTMLInputElement)) return;
  const input = e.target;
  // Awaited so the cap is counted from the fresh list when it is nearly here, which is the common
  // case. Not a guard — see above.
  await refreshed;
  if (!(await promoteToolbarPin(toolbarPinKey(pin), input.checked, live.value))) input.checked = promoted(pin);
}
</script>

<template>
  <p class="mb-2 mt-1.5 text-[12px] text-dim">{{ t("settings.toolbarPins.intro", { max: MAX_TOOLBAR_PINS }) }}</p>
  <!-- An empty list with an error behind it, and an empty list because nothing is pinned, are
       DIFFERENT: "go and pin something first" is unfollowable advice when the list simply is not
       there, and this pane is nothing but that list.
       Only when it is EMPTY, and worded for any failure rather than a failed read: `loadError` is
       also what a failed pin/unpin sets (`persist` in useShortcuts), and that leaves the list
       loaded and worth showing — reporting it here as "could not read your pins" would describe
       neither the cause nor what is on screen (Codex, PR #1991). -->
  <p v-if="!shortcuts.length && loadError" class="mb-2 text-[12px] text-warn">{{ t("settings.toolbarPins.unavailable", { error: loadError }) }}</p>
  <p v-else-if="!shortcuts.length" class="mb-2 text-[12px] text-dim">{{ t("settings.toolbarPins.empty") }}</p>
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
