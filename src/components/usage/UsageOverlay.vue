<script setup lang="ts">
// What each rotation token has left of its 5h and 7d windows (#2919), one row per token. Opened from
// the feature menu, which offers it only while token rotation is on. Polls the same readings as the
// toolbar's gauge, and only while it is open.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import FullScreenOverlay from "../FullScreenOverlay.vue";
import { useUsageView } from "../../composables/useUsageView";
import { useEscapeToClose } from "../../composables/useEscapeToClose";
import { useRateLimits } from "../../composables/useRateLimits";
import { resetsIn } from "../../composables/rateLimitGauge";
import { tokenUsageRows, type TokenUsageRow, type TokenUsageWindow } from "../../composables/tokenUsageRows";

const { t, locale } = useI18n();
const { isOpen, close } = useUsageView();
useEscapeToClose(isOpen, close);

const { snapshot, start, stop } = useRateLimits();
const MS_PER_SEC = 1000;
const CLOCK_TICK_MS = 30_000;
const LOW_LEFT_PERCENT = 10;
const now_ms = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;

// Reading only while open is the gauge's own rule: the probes it drives spend a query per token.
function startPolling(): void {
  if (clock) return;
  start();
  clock = setInterval(() => (now_ms.value = Date.now()), CLOCK_TICK_MS);
}
function stopPolling(): void {
  if (!clock) return;
  stop();
  clearInterval(clock);
  clock = null;
}
watch(isOpen, (open) => (open ? startPolling() : stopPolling()), { immediate: true });
onBeforeUnmount(stopPolling);

const rows = computed(() => tokenUsageRows(snapshot.value?.accounts ?? [], now_ms.value));
const windowsOf = (row: TokenUsageRow) => [
  { key: "fiveHour", window: row.fiveHour },
  { key: "sevenDay", window: row.sevenDay },
];

const leftText = (window: TokenUsageWindow): string => (window.leftPercent === null ? "—" : `${window.leftPercent}%`);
const resetText = (window: TokenUsageWindow): string => resetsIn(window.resetsAt_sec, now_ms.value, t);
const RESET_DATE_FORMAT: Intl.DateTimeFormatOptions = { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" };
const limitResetLines = (row: TokenUsageRow): string[] =>
  [
    { column: "fiveHour", reset_sec: row.limitResets?.fiveHour_sec ?? null },
    { column: "sevenDay", reset_sec: row.limitResets?.sevenDay_sec ?? null },
  ].flatMap(({ column, reset_sec }) =>
    reset_sec === null
      ? []
      : [
          t("usageView.limitReset", {
            window: t(`usageView.column.${column}`),
            at: new Date(reset_sec * MS_PER_SEC).toLocaleString(locale.value, RESET_DATE_FORMAT),
          }),
        ],
  );
const barClass = (window: TokenUsageWindow): string => ((window.leftPercent ?? 0) <= LOW_LEFT_PERCENT ? "bg-amber" : "bg-accent");
</script>

<template>
  <FullScreenOverlay v-if="isOpen" :region-label="t('usageView.region')" :close-label="t('usageView.close')" @close="close">
    <template #header>
      <span class="font-sans text-[14px] font-[650] text-fg">{{ t("usageView.title") }}</span>
    </template>

    <div class="min-h-0 flex-1 overflow-auto p-4">
      <p class="mb-3 font-sans text-[12px] text-secondary">{{ t("usageView.intro") }}</p>
      <table class="w-full border-collapse font-sans text-[13px]" data-testid="usage-table">
        <thead>
          <tr class="border-b border-border text-left text-[12px] text-secondary">
            <th class="py-1.5 pr-4 font-[550]">{{ t("usageView.column.subscription") }}</th>
            <th class="py-1.5 pr-4 font-[550]">{{ t("usageView.column.fiveHour") }}</th>
            <th class="py-1.5 pr-4 font-[550]">{{ t("usageView.column.sevenDay") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" class="border-b border-border" :data-testid="`usage-row-${row.id}`">
            <td class="py-2 pr-4 align-top">
              <div class="text-fg">{{ row.label }}</div>
              <div v-if="row.email" class="font-mono text-[11px] text-secondary">{{ row.email }}</div>
            </td>
            <template v-if="row.state === 'ok'">
              <td v-for="{ key, window } in windowsOf(row)" :key="key" class="py-2 pr-4 align-top">
                <div class="flex items-center gap-2">
                  <div class="h-1.5 w-24 overflow-hidden rounded-full bg-elevated">
                    <div class="h-full" :class="barClass(window)" :style="{ width: `${window.leftPercent ?? 0}%` }"></div>
                  </div>
                  <span class="font-mono text-fg">{{ t("usageView.left", { percent: leftText(window) }) }}</span>
                </div>
                <div class="text-[11px] text-secondary">{{ resetText(window) }}</div>
              </td>
            </template>
            <td v-else colspan="2" class="py-2 pr-4 align-top text-secondary">
              <div>{{ t(`usageView.state.${row.state}`) }}</div>
              <div v-for="line in limitResetLines(row)" :key="line" class="text-[11px]">{{ line }}</div>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="3" class="py-3 text-secondary">{{ t("usageView.empty") }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </FullScreenOverlay>
</template>
