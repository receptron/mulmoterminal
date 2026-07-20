<script setup lang="ts">
// Shared scaffold for the toolbar popovers (notifications, remote host): a square
// icon trigger that toggles an anchored panel. Owns the open/close state and the
// outside-click / Escape dismissal via useDropdownMenu; each consumer supplies its
// own trigger extras (slot) and panel body (default slot).
import { useTemplateRef } from "vue";
import { useDropdownMenu } from "../composables/useDropdownMenu";

defineProps<{
  icon: string;
  title: string;
  triggerLabel: string;
  paneClass: string;
  paneLabel: string;
  triggerClass?: Record<string, boolean>;
}>();

const emit = defineEmits<{ open: [] }>();

const rootRef = useTemplateRef<HTMLElement>("root");
const { open, close, toggle } = useDropdownMenu(rootRef, () => emit("open"));

defineExpose({ close });
</script>

<template>
  <div ref="root" class="toolbar-popover-root">
    <button
      type="button"
      class="toolbar-popover-btn"
      :class="[{ active: open }, triggerClass]"
      :aria-expanded="open"
      aria-haspopup="true"
      :title="title"
      :aria-label="triggerLabel"
      @click="toggle"
    >
      <span class="material-symbols-outlined">{{ icon }}</span>
      <slot name="trigger-extra" />
    </button>

    <div v-if="open" class="toolbar-popover" :class="paneClass" role="group" :aria-label="paneLabel">
      <slot />
    </div>
  </div>
</template>

<style scoped src="./toolbarPopover.css"></style>
