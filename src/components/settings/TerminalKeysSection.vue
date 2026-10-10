<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { copyOnSelect, saveCopyOnSelect } from "../../composables/copyOnSelect";
import { questionPaneEnabled, saveQuestionPaneEnabled } from "../../composables/questionPane";
import { terminalSubmitMode, saveTerminalSubmitMode } from "../../composables/terminalSubmitMode";
import { TERMINAL_SUBMIT_MODES, isTerminalSubmitMode } from "../../../common/terminalSubmit";
import { tmuxPrefix, saveTmuxPrefix } from "../../composables/tmuxPrefix";
import { TMUX_PREFIX_LABEL_KEYS, isTmuxPrefix, tmuxPrefixChoicesFor } from "../../../common/tmuxPrefix";

// The key-behaviour settings that are a single value each, so they get a control here rather
// than the skill the keymap needs. The keymap itself stays read-only in KeyboardShortcutsSection:
// a binding takes its key away from the program inside the terminal, which is a question about the
// user's agent, not a toggle.
const { t } = useI18n();

function onCopyOnSelectToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) void saveCopyOnSelect(e.target.checked);
}

function onQuestionPaneToggle(e: Event) {
  if (e.target instanceof HTMLInputElement) void saveQuestionPaneEnabled(e.target.checked);
}

function onSubmitModeChange(e: Event) {
  if (e.target instanceof HTMLSelectElement && isTerminalSubmitMode(e.target.value)) void saveTerminalSubmitMode(e.target.value);
}

function onTmuxPrefixChange(e: Event) {
  if (e.target instanceof HTMLSelectElement && isTmuxPrefix(e.target.value)) void saveTmuxPrefix(e.target.value);
}
</script>

<template>
  <label class="mt-1.5 flex cursor-pointer items-start gap-2">
    <input
      type="checkbox"
      class="mt-1 cursor-pointer"
      :checked="copyOnSelect"
      :aria-label="t('settings.terminalKeys.copyOnSelect')"
      @change="onCopyOnSelectToggle"
    />
    <span class="text-[12px]">
      <strong>{{ t("settings.terminalKeys.copyOnSelectTitle") }}</strong> — {{ t("settings.terminalKeys.copyOnSelectHint") }}
    </span>
  </label>

  <!-- Here rather than under a pane heading: what the switch turns on is keys being typed into
       the terminal on the user's behalf, which is what this section is about. -->
  <label class="mt-1.5 flex cursor-pointer items-start gap-2">
    <input
      type="checkbox"
      class="mt-1 cursor-pointer"
      :checked="questionPaneEnabled"
      :aria-label="t('settings.terminalKeys.questionPane')"
      @change="onQuestionPaneToggle"
    />
    <span class="text-[12px]">
      <strong>{{ t("settings.terminalKeys.questionPaneTitle") }}</strong> — {{ t("settings.terminalKeys.questionPaneHint") }}
    </span>
  </label>

  <p class="mb-1.5 mt-3 text-[12px] text-dim">
    <strong class="text-fg">{{ t("settings.terminalKeys.enterTitle") }}</strong> — {{ t("settings.terminalKeys.enterHint") }}
  </p>
  <select
    class="mb-1 w-full cursor-pointer rounded-lg border border-border bg-elevated px-2 py-1.5 text-[12px] text-fg"
    :value="terminalSubmitMode"
    :aria-label="t('settings.terminalKeys.enterField')"
    @change="onSubmitModeChange"
  >
    <option v-for="mode in TERMINAL_SUBMIT_MODES" :key="mode" :value="mode">{{ t(`settings.terminalKeys.modes.${mode}`) }}</option>
  </select>

  <p class="mb-1.5 mt-3 text-[12px] text-dim">
    <strong class="text-fg">{{ t("settingsControls.tmuxPrefix.title") }}</strong> — {{ t("settingsControls.tmuxPrefix.hint") }}
  </p>
  <select
    class="mb-1 w-full cursor-pointer rounded-lg border border-border bg-elevated px-2 py-1.5 text-[12px] text-fg"
    :value="tmuxPrefix"
    :aria-label="t('settingsControls.tmuxPrefix.field')"
    @change="onTmuxPrefixChange"
  >
    <option v-for="choice in tmuxPrefixChoicesFor(tmuxPrefix)" :key="choice" :value="choice">
      {{ TMUX_PREFIX_LABEL_KEYS[choice] ? t(`settingsControls.tmuxPrefix.options.${TMUX_PREFIX_LABEL_KEYS[choice]}`) : choice }}
    </option>
  </select>
</template>
