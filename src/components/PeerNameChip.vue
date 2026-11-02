<script setup lang="ts">
// The name the other Claude Code sessions on this machine use to message this one (#3237). An icon
// only: the name is for pasting into another cell, not for reading across nine of them, and the
// tooltip carries it for the glance that tells two cells of one repo apart.
import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { CELL_CHIP_BTN, CELL_CHIP_ICON } from "./cellChromeClasses";

const props = defineProps<{ name: string | null }>();
const { t } = useI18n();

const COPIED_MS = 1500;
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  if (props.name === null) return;
  try {
    await navigator.clipboard.writeText(props.name);
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), COPIED_MS);
  } catch {
    // best-effort — the name is on the tooltip to copy by hand
  }
}

onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>

<template>
  <button
    v-if="name !== null"
    type="button"
    data-testid="cell-peer-chip"
    :class="CELL_CHIP_BTN"
    :data-tip="copied ? t('tips.cell.peerCopied', { name }) : t('tips.cell.peerName', { name })"
    :aria-label="t('tips.cell.peerNameAria', { name })"
    @click.stop="copy"
  >
    <span :class="CELL_CHIP_ICON" aria-hidden="true">{{ copied ? "check" : "alternate_email" }}</span>
  </button>
</template>
