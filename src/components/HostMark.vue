<script setup lang="ts">
// The remote host a cell's terminal runs on (#3506): identity, like AccountMark, so it stays on a
// filmstrip thumbnail. The tip says what the cell cannot do here, since the missing buttons do not.
import { useI18n } from "vue-i18n";

defineProps<{ host: string }>();
const { t } = useI18n();

const MARK_CLASS =
  "inline-flex max-w-[12ch] flex-none items-center gap-1 rounded-[10px] border border-border bg-elevated px-[7px] py-px font-mono text-[11px] text-secondary";
</script>

<template>
  <span data-testid="cell-host-mark" :class="MARK_CLASS" :data-tip="t('tips.cell.remoteHost', { host })" :aria-label="t('tips.cell.remoteHost', { host })"
    ><span class="material-symbols-outlined text-[13px]" aria-hidden="true">dns</span><span class="truncate">{{ host }}</span></span
  >
</template>
