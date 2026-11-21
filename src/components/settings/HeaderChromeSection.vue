<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { headerButtonCount, headerChipCount } from "../../composables/headerConfigSummary";
import SkillLaunchButton from "../SkillLaunchButton.vue";
import GlobalHeaderStatusColors from "./GlobalHeaderStatusColors.vue";
import HeaderChipsEditor from "./HeaderChipsEditor.vue";
import HeaderButtonsEditor from "./HeaderButtonsEditor.vue";
import type { BundledSkillName } from "../../../common/bundledSkills";
import { HEADER_STATUS_TINTS, sanitizeHeaderStatusTint } from "../../../common/headerStatusColors";
import { globalHeaderStatusTint, saveHeaderStatusTint } from "../../composables/headerStatusColors";
import { cellSendButton, saveCellSendButton } from "../../composables/cellSendButton";

// Chips and the two simplest kinds of button are edited here; folders and buttons that open
// something are still written by the skill, which asks what they should do and where they appear.
defineEmits<{ (e: "launch-skill", skill: BundledSkillName): void }>();

const { t } = useI18n();

// Three states, not a count: `null` is "the key is unconfigured, so the built-in header applies",
// and 0 is "a user removed every one" — saying "0" for both would hide that difference.
function describe(count: number | null, kind: "Buttons" | "Chips"): string {
  if (count === null) return t(`settings.headerChrome.builtIn${kind}`);
  if (count === 0) return t(`settings.headerChrome.no${kind}`);
  return t(`settings.headerChrome.some${kind}`, { count }, count);
}

// Locked while saving, so an earlier pick's answer cannot land after a later one.
const savingTint = ref(false);

async function onTintChange(e: Event) {
  if (!(e.target instanceof HTMLSelectElement)) return;
  const select = e.target;
  const picked = sanitizeHeaderStatusTint(select.value);
  savingTint.value = true;
  if (picked !== null) await saveHeaderStatusTint(picked);
  savingTint.value = false;
  select.value = globalHeaderStatusTint.value;
}

async function onSendButtonToggle(e: Event) {
  if (!(e.target instanceof HTMLInputElement)) return;
  const input = e.target;
  if (!(await saveCellSendButton(input.checked))) input.checked = cellSendButton.value;
}
</script>

<template>
  <i18n-t keypath="settings.headerChrome.intro" tag="p" class="mb-2 mt-1.5 text-[12px] text-dim">
    <template #buttons>
      <strong class="text-fg">{{ describe(headerButtonCount, "Buttons") }}</strong>
    </template>
    <template #chips>
      <strong class="text-fg">{{ describe(headerChipCount, "Chips") }}</strong>
    </template>
    <template #dirFile><code>.mulmoterminal.json</code></template>
  </i18n-t>
  <p class="mb-1.5 mt-3 text-[12px] text-dim">
    <strong class="text-fg">{{ t("settingsControls.headerTint.title") }}</strong> (<code>headerStatusTint</code>) — {{ t("settingsControls.headerTint.hint") }}
  </p>
  <select
    class="mb-3 w-full cursor-pointer rounded-lg border border-border bg-elevated px-2 py-1.5 text-[12px] text-fg"
    data-testid="settings-header-tint"
    :value="globalHeaderStatusTint"
    :disabled="savingTint"
    :aria-label="t('settingsControls.headerTint.field')"
    @change="(e) => void onTintChange(e)"
  >
    <option v-for="mode in HEADER_STATUS_TINTS" :key="mode" :value="mode">{{ t(`settingsControls.headerTint.tints.${mode}`) }}</option>
  </select>
  <label class="mb-3 flex cursor-pointer items-start gap-2">
    <input
      type="checkbox"
      class="mt-1 cursor-pointer"
      :checked="cellSendButton"
      :aria-label="t('settings.headerChrome.sendButton')"
      data-testid="settings-cell-send-button"
      @change="(e) => void onSendButtonToggle(e)"
    />
    <span class="text-[12px]">
      <strong>{{ t("settings.headerChrome.sendButton") }}</strong> (<code>cellSendButton</code>) — {{ t("settings.headerChrome.sendButtonHint") }}
    </span>
  </label>
  <GlobalHeaderStatusColors />
  <HeaderButtonsEditor />
  <HeaderChipsEditor />
  <div class="mb-3">
    <SkillLaunchButton skill="mulmoterminal-header" icon="widgets" :label="t('settings.headerChrome.setUp')" @launch="$emit('launch-skill', $event)" />
  </div>
</template>
