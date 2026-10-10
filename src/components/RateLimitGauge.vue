<script setup lang="ts">
// The 5h / 7d windows, always on screen in the grid header (#387).
//
// Always visible rather than a hover tip, which is what #388 shipped and what this replaces: the
// point is to notice a window filling up WITHOUT going to look, because by the time you think to
// check you have usually already hit it. The reset times stay on hover — they answer the second
// question, not the first.
import { computed, onMounted, onUnmounted } from "vue";
import { useRateLimits } from "../composables/useRateLimits";
import { rateLimitReadout } from "../composables/rateLimitGauge";
import AgentMark from "./AgentMark.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const { snapshot, start, stop } = useRateLimits();
onMounted(start);
onUnmounted(stop);

// The clock is read ONCE per reading, and everything derived from it comes out of the same pass:
// the figures, the hover text, and the decision to drop a window whose reset has gone by. Reading
// Date.now() separately in each of those let them disagree — a window could be dropped as expired
// while its own hover text still counted down.
//
// `probeNote` sits where the numbers would be, in the muted colour, because it is the same kind of
// information: "here is what we know about your usage" (#1011).
const view = computed(() => {
  const now_ms = Date.now();
  return { now_ms, ...rateLimitReadout(snapshot.value, now_ms, t) };
});
const gauges = computed(() => view.value.gauges);
const probeNote = computed(() => view.value.note);
const accountNotes = computed(() => view.value.accountNotes);
</script>

<template>
  <!-- Nothing at all until something reports: an agent that is not installed, is on API-key
       billing, or has not run yet all arrive here as an empty list, and an empty gauge would be
       one more thing to explain rather than information. -->
  <span
    v-if="probeNote"
    class="ml-1.5 inline-flex flex-none items-center border-l border-border pl-2.5 font-mono text-[12px] leading-none text-dim"
    role="note"
    :data-tip="probeNote"
    data-testid="rate-limit-note"
    >claude usage n/a</span
  >
  <!-- A login that is OUT is the state that stops the work, so it takes the warning colour the
       gauge gives a window near its ceiling, rather than the muted one for "not measured" (#2995). -->
  <span
    v-for="entry in accountNotes"
    :key="entry.key"
    class="ml-1.5 inline-flex flex-none items-center gap-1.5 border-l border-border pl-2.5 font-mono text-[12px] leading-none"
    :class="entry.warn ? 'text-amber' : 'text-dim'"
    role="note"
    :data-tip="entry.note"
    data-testid="rate-limit-account-note"
  >
    <AgentMark agent="claude" :class="entry.warn ? 'text-amber' : 'text-muted'" />
    <span class="max-w-[10ch] truncate">{{ entry.label }}</span>
    <span>{{ entry.status }}</span>
  </span>
  <span
    v-for="gauge in gauges"
    :key="gauge.key"
    class="ml-1.5 inline-flex flex-none items-center gap-1.5 border-l border-border pl-2.5"
    role="img"
    :aria-label="gauge.title"
    :data-tip="gauge.title"
    :data-testid="gauge.key.startsWith('account:') ? 'rate-limit-account' : undefined"
  >
    <AgentMark v-if="gauge.marked" :agent="gauge.agent" :class="gauge.windows.some((w) => w.warn) ? 'text-amber' : 'text-muted'" />
    <span v-if="gauge.label" class="max-w-[10ch] truncate font-mono text-[12px] leading-none text-dim" aria-hidden="true">{{ gauge.label }}</span>
    <span
      v-for="window in gauge.windows"
      :key="window.label"
      class="font-mono text-[12px] leading-none"
      :class="window.warn ? 'text-amber' : 'text-muted'"
      aria-hidden="true"
      >{{ window.label }} {{ window.percent }}%</span
    >
  </span>
</template>
