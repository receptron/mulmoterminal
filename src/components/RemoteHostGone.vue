<script setup lang="ts">
// In place of the terminal of a cell whose remote host (#3506) is no longer configured. The gateway
// refuses its socket, and the reconnect loop would retry it forever with nothing on screen saying why.
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{ host: string }>();
</script>

<template>
  <div data-testid="remote-host-gone" class="flex min-h-0 flex-1 items-center justify-center p-4">
    <p class="flex max-w-[480px] items-start gap-2 text-[12px] leading-snug text-secondary">
      <span class="material-symbols-outlined text-[16px] text-amber" aria-hidden="true">link_off</span>
      <span>{{ t("tips.cell.remoteHostGone", { host }) }}</span>
    </p>
  </div>
</template>
