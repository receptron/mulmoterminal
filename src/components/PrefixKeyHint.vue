<script setup lang="ts">
// What a pressed prefix is waiting for (#2265): each key that can follow it and the action it runs.
// Without it a prefix is a key that silently did nothing, and the second key has to be remembered.
import { useI18n } from "vue-i18n";
import type { PendingPrefix } from "../composables/prefixKeys";
import { keymapLabelKey } from "./keymapLabels";

defineProps<{ pending: PendingPrefix | null }>();
const { t } = useI18n();
</script>

<template>
  <div
    v-if="pending"
    role="status"
    aria-live="polite"
    data-testid="prefix-key-hint"
    class="pointer-events-none fixed bottom-4 right-4 z-[70] min-w-[200px] font-sans rounded-lg border border-border bg-panel px-3 py-2 text-[12px] text-fg shadow-xl"
  >
    <p class="mb-1.5 text-secondary">
      <i18n-t keypath="prefixKeys.waiting">
        <template #key
          ><code class="font-mono">{{ pending.firstLabel }}</code></template
        >
      </i18n-t>
    </p>
    <ul class="flex flex-col gap-1">
      <li v-for="candidate in pending.candidates" :key="candidate.action" class="flex items-center gap-2">
        <code class="min-w-[2ch] rounded border border-border bg-subtle px-1.5 py-0.5 text-center font-mono text-[11px]">{{ candidate.secondLabel }}</code>
        <span>{{ t(keymapLabelKey(candidate.action)) }}</span>
      </li>
    </ul>
    <p class="mt-1.5 text-muted">{{ t("prefixKeys.cancel") }}</p>
  </div>
</template>
