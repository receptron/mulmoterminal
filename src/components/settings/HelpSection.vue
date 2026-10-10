<script setup lang="ts">
import { useI18n } from "vue-i18n";
import GuideLinks from "../GuideLinks.vue";
import SkillLaunchButton from "../SkillLaunchButton.vue";

const emit = defineEmits<{ (e: "launch-help"): void }>();

const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col gap-3">
    <GuideLinks />
    <div>
      <SkillLaunchButton skill="mulmoterminal-help" icon="help" :label="t('settings.help.ask')" :hint="t('settings.help.hint')" @launch="emit('launch-help')" />
    </div>
  </div>
</template>
