<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useRosterAlert } from "../../composables/useRosterAlert";
import { cockpitLines, saveCockpitLines } from "../../composables/cockpitLines";
import { COCKPIT_LINES_MIN, COCKPIT_LINES_MAX, type CockpitLines } from "../../../common/cockpitLines";
import { cockpitCompact, saveCockpitCompact } from "../../composables/cockpitCompact";
import SettingsStepper from "./SettingsStepper.vue";

// Whether a roster row waiting on the user blinks (#1131) — per browser for the same reason the
// sizes above are: it is the person watching the screen who finds movement useful or distracting,
// not the host.
const { t } = useI18n();
const { blink: rosterBlink, setBlink: setRosterBlink } = useRosterAlert();
function onRosterBlinkToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) setRosterBlink(e.target.checked);
}

// How far each roster line clamps (#877) — GLOBAL, unlike the blink above: it trades roster length
// against how much of a row you can read, which is a property of the sessions rather than of the
// screen you happen to be watching.
//
// One stepper per field because the three are worth different amounts: a summary says what a
// session is doing now, while a prompt is usually done in two lines.
const LINE_FIELDS: (keyof CockpitLines)[] = ["summary", "prompt", "response"];
const LINE_STEP = 1;

// The whole object goes each time — the saver's contract, since the server merges by field.
function nudgeLines(key: keyof CockpitLines, delta: number) {
  void saveCockpitLines({ ...cockpitLines.value, [key]: cockpitLines.value[key] + delta });
}
// A refused save puts the box back, as the grid header's switches do.
async function onCompactToggle(e: Event) {
  const input = e.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (!(await saveCockpitCompact(input.checked))) input.checked = cockpitCompact.value;
}
</script>

<template>
  <i18n-t keypath="settings.waitingRows.intro" tag="p" class="mb-2 mt-1.5 text-[12px] text-dim">
    <template #waiting>
      <strong>{{ t("settings.waitingRows.waiting") }}</strong>
    </template>
    <template #finished>
      <strong>{{ t("settings.waitingRows.finished") }}</strong>
    </template>
  </i18n-t>
  <label class="mb-3 flex cursor-pointer items-center gap-2">
    <input type="checkbox" class="cursor-pointer" :checked="rosterBlink" :aria-label="t('settings.waitingRows.blink')" @change="onRosterBlinkToggle" />
    <span class="text-[13px]">{{ t("settings.waitingRows.blink") }}</span>
  </label>

  <p class="mb-2 text-[12px] text-dim">
    <strong class="text-fg">{{ t("settings.waitingRows.linesTitle") }}</strong> — {{ t("settings.waitingRows.linesHint") }}
  </p>
  <label class="mb-2 flex cursor-pointer items-center gap-2">
    <input
      type="checkbox"
      data-testid="cockpit-compact"
      class="cursor-pointer"
      :checked="cockpitCompact"
      :aria-label="t('settings.waitingRows.compact')"
      @change="onCompactToggle"
    />
    <span class="text-[13px]">{{ t("settings.waitingRows.compact") }}</span>
  </label>
  <div v-for="field in LINE_FIELDS" :key="field" class="mb-1.5 flex items-center gap-3">
    <span class="min-w-[92px] text-[12px] text-fg">{{ t(`settings.waitingRows.fields.${field}`) }}</span>
    <SettingsStepper
      :value="cockpitLines[field]"
      :unit="''"
      :min="COCKPIT_LINES_MIN"
      :max="COCKPIT_LINES_MAX"
      :step="LINE_STEP"
      :disabled="cockpitCompact"
      :label="t(`settings.waitingRows.steppers.${field}`)"
      @nudge="nudgeLines(field, $event)"
    />
  </div>
</template>
