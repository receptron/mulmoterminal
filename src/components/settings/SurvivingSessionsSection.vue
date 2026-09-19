<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useSurvivingSessions } from "../../composables/useSurvivingSessions";
import { useSessionStop } from "../../composables/useSessionStop";
import { sessionIdleReapDays, saveSessionIdleReapDays, sessionReapIntervalHours, saveSessionReapIntervalHours } from "../../composables/sessionReap";
import {
  MAX_REAP_IDLE_DAYS,
  MAX_REAP_INTERVAL_HOURS,
  MIN_REAP_IDLE_DAYS,
  MIN_REAP_INTERVAL_HOURS,
  REAP_IDLE_DAYS_OFF,
  reapTimerEnabled,
} from "../../../common/sessionReap";
import { relativeTime } from "../cellDisplay";
import SettingsStepper from "./SettingsStepper.vue";
import { SETTINGS_LIST } from "./sectionClasses";
import type { SurvivingSession } from "../../../common/survivingSessions";

// Sessions that outlived the server, across every directory (#1478).
//
// tmux persistence is why they are here at all, and until now the app could only show one you
// happened to be looking at: the launcher's rows are per directory and per agent (#1474), so a
// project you no longer open — and a Shell session, which has no conversation to list — appeared
// nowhere and could only be ended with `tmux kill-session` by hand.
//
// One row at a time on purpose: a single click that ends many live agents would be the automatic
// sweep wearing a button, and the sweep already exists with a rule of its own — which this section
// also owns the number for, since it is the list that number acts on (#1467).
const { t } = useI18n();
const { sessions, loading, failed, reload } = useSurvivingSessions();
const { stopping, stopSession } = useSessionStop(reload);

onMounted(reload);

// The row's own words for what it is. `null` covers a shell and a launcher command — the rows
// listed nowhere else, which is why it is named rather than left blank — but ALSO an agy, grok or
// muse session that outlived its pty, which nothing can map back to a key. So it says "unknown"
// too rather than calling something a shell on no evidence; the hover carries the whole answer.
const describe = (s: SurvivingSession): string => s.agent ?? t("settings.surviving.shellOrUnknown");

// Through the same formatter the cells use, from an absolute moment rather than the elapsed
// seconds: one vocabulary for "how long ago" across the app, and no second rounding rule.
const MS_PER_SECOND = 1000;
const lastActive = (s: SurvivingSession): string => {
  if (s.idleSeconds === null) return "";
  const now = Date.now();
  return t("settings.surviving.lastActive", { when: relativeTime(now - s.idleSeconds * MS_PER_SECOND, now) });
};

const REAP_STEP_DAYS = 1;
const SWEEP_STEP_HOURS = 1;

// Re-read after saving: `reapable` is the SERVER's answer against the old threshold, so raising it
// would otherwise leave rows saying "ends at next start" about a start that will now spare them
// (CodeRabbit on #1486).
async function nudgeIdleDays(delta: number): Promise<void> {
  if (await saveSessionIdleReapDays(sessionIdleReapDays.value + delta)) await reload();
}

// No reload here, unlike the days above: the cadence does not change WHICH rows are reapable, only
// how soon the sweep asks — so `reapable` is still the server's current answer (#2165).
const nudgeSweepHours = (delta: number): void => void saveSessionReapIntervalHours(sessionReapIntervalHours.value + delta);

// What a doomed row promises. With the timer armed the sweep comes round on its own, so "ends at
// next start" would be the one thing the row says that a running server makes false.
const sweeping = computed(() => reapTimerEnabled(sessionReapIntervalHours.value));

// Nothing is swept at any cadence when the threshold above is off, so the cadence row says that
// rather than promising a sweep every few hours that will never end anything.
const sweepDisabled = computed(() => sessionIdleReapDays.value === REAP_IDLE_DAYS_OFF);
</script>

<template>
  <i18n-t keypath="settings.surviving.intro" tag="p" class="mb-2 mt-1.5 text-[12px] text-dim">
    <template #whatever>
      <strong class="text-fg">{{ t("settings.surviving.whatever") }}</strong>
    </template>
  </i18n-t>

  <p v-if="loading" class="mb-2 text-[12px] text-dim">{{ t("settings.surviving.loading") }}</p>
  <p v-else-if="failed" class="mb-2 text-[12px] text-dim">{{ t("settings.surviving.failed") }}</p>
  <ul v-else-if="sessions.length" :class="SETTINGS_LIST">
    <li v-for="s in sessions" :key="s.key" data-testid="surviving-row" class="flex items-baseline gap-2 rounded-md bg-elevated px-2 py-1.5">
      <span class="truncate font-mono text-[12px] text-secondary" :title="s.cwd ?? t('settings.surviving.unknownDirTitle')">
        {{ s.cwd ?? t("settings.surviving.unknownDir") }}
      </span>
      <span class="flex-none text-[11px] text-dim" :title="s.agent ? '' : t('settings.surviving.unknownAgentTitle')">{{ describe(s) }}</span>
      <span v-if="lastActive(s)" data-testid="surviving-idle" class="flex-none text-[11px] text-dim">{{ lastActive(s) }}</span>
      <span class="flex-auto" />
      <!-- Resumable is what makes stopping safe to offer at all: the conversation comes back. Said
           on the row that is NOT, because there the session is the only copy of its scrollback. -->
      <span v-if="!s.resumable" data-testid="surviving-only-copy" class="flex-none text-[11px] text-dim" :title="t('settings.surviving.notResumableTitle')">
        {{ t("settings.surviving.notResumable") }}
      </span>
      <!-- The sweep is the one thing here that acts unasked, so the rows it will take say so. -->
      <span
        v-if="s.reapable"
        data-testid="surviving-doomed"
        class="flex-none text-[11px] text-dim"
        :title="
          sweeping
            ? t('settings.surviving.doomedSoonTitle', { days: sessionIdleReapDays, hours: sessionReapIntervalHours })
            : t('settings.surviving.doomedTitle', { days: sessionIdleReapDays })
        "
        >{{ sweeping ? t("settings.surviving.doomedSoon") : t("settings.surviving.doomed") }}</span
      >
      <span v-if="s.attached" data-testid="surviving-open" class="flex-none text-[11px] text-amber" :title="t('settings.surviving.openTitle')">{{
        t("settings.surviving.open")
      }}</span>
      <button
        v-else
        data-testid="surviving-stop"
        class="flex-none cursor-pointer rounded-md border-none bg-transparent px-1.5 py-1 text-[13px] hover:bg-[var(--err-hover-bg)] disabled:cursor-progress"
        :disabled="stopping === s.key"
        :title="t('settings.surviving.stopTitle')"
        :aria-label="t('settings.surviving.stopAria', { dir: s.cwd ?? t('settings.surviving.stopAriaUnknown') })"
        @click="stopSession({ id: s.key, title: s.cwd ?? s.key, runningKey: s.key })"
      >
        <span class="material-symbols-outlined" aria-hidden="true">stop_circle</span>
      </button>
    </li>
  </ul>
  <p v-else class="mb-2 text-[12px] text-dim">{{ t("settings.surviving.none") }}</p>

  <div class="mb-3 mt-2 flex items-center gap-3">
    <SettingsStepper
      :value="sessionIdleReapDays"
      :unit="t('settings.surviving.reapUnit')"
      :min="MIN_REAP_IDLE_DAYS"
      :max="MAX_REAP_IDLE_DAYS"
      :step="REAP_STEP_DAYS"
      :label="t('settings.surviving.reapStepper')"
      @nudge="nudgeIdleDays"
    />
    <span class="text-[12px] text-dim">
      <template v-if="sessionIdleReapDays === REAP_IDLE_DAYS_OFF">
        <strong class="text-fg">{{ t("settings.surviving.neverTitle") }}</strong> {{ t("settings.surviving.neverHint") }}
      </template>
      <i18n-t v-else keypath="settings.surviving.reapHint" tag="span">
        <template #ended>
          <strong class="text-fg">{{ sweeping ? t("settings.surviving.reapEndedSweep") : t("settings.surviving.reapEnded") }}</strong>
        </template>
      </i18n-t>
    </span>
  </div>

  <!-- How often that threshold is applied. Its own row because it is the other half of one
       decision: the days say WHICH sessions go, this says how long a running server waits before
       asking (#2165). -->
  <div class="mb-3 flex items-center gap-3">
    <SettingsStepper
      :value="sessionReapIntervalHours"
      :unit="t('settings.surviving.sweepUnit')"
      :min="MIN_REAP_INTERVAL_HOURS"
      :max="MAX_REAP_INTERVAL_HOURS"
      :step="SWEEP_STEP_HOURS"
      :label="t('settings.surviving.sweepStepper')"
      :disabled="sweepDisabled"
      @nudge="nudgeSweepHours"
    />
    <span class="text-[12px] text-dim">
      <template v-if="sweepDisabled">{{ t("settings.surviving.sweepDisabledHint") }}</template>
      <template v-else-if="sweeping">{{ t("settings.surviving.sweepHint", { hours: sessionReapIntervalHours }) }}</template>
      <template v-else>
        <strong class="text-fg">{{ t("settings.surviving.sweepOffTitle") }}</strong> {{ t("settings.surviving.sweepOffHint") }}
      </template>
    </span>
  </div>
</template>
