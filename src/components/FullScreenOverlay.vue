<script setup lang="ts">
// The frame a full-screen overlay sits in: the region under the top bar, and a header whose left
// side the overlay fills and whose right side is always the close button. Created on the first open
// and only hidden after, so a screen opened again shows what it had instead of reading it all again.
import { toRef } from "vue";
import { useI18n } from "vue-i18n";
import { provideOverlayVisible, useEverOpened } from "../composables/overlayVisibility";

const props = defineProps<{ open: boolean; regionLabel: string; closeLabel: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const open = toRef(props, "open");
provideOverlayVisible(open);
const everOpened = useEverOpened(open);
</script>

<template>
  <div v-if="everOpened" v-show="open" class="fixed inset-x-0 top-(--screen-top) bottom-0 z-50 flex flex-col bg-deep" role="region" :aria-label="regionLabel">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <slot name="header" />
      <span class="flex-1"></span>
      <button
        type="button"
        class="h-6 w-[26px] cursor-pointer rounded-md border border-border bg-base text-[14px] text-secondary hover:bg-hover hover:text-fg"
        :data-tip="t('tips.overlays.close')"
        :aria-label="closeLabel"
        @click="emit('close')"
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    <slot />
  </div>
</template>
