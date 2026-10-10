<script setup lang="ts">
// A Settings button that hands the section over to the skill which owns that setting.
//
// `skill` is typed rather than a free string on purpose: a slug that names no shipped skill
// fails nothing anywhere — typecheck, lint and the specs all pass, and the only symptom is the
// launched agent replying that it can't find it, in a session the user has to read to notice.
// `BundledSkillName` moves that to the moment it is written.
import { useI18n } from "vue-i18n";
import SettingsButton from "./SettingsButton.vue";
import type { BundledSkillName } from "../../common/bundledSkills";

// `hint` replaces the shared sentence, which promises config edits: a skill that only answers
// questions (the help desk) must not be introduced as one that writes a file.
defineProps<{ skill: BundledSkillName; icon: string; label: string; hint?: string }>();
const emit = defineEmits<{ (e: "launch", skill: BundledSkillName): void }>();

const { t } = useI18n();
</script>

<template>
  <SettingsButton :data-skill="skill" @click="emit('launch', skill)">
    <span class="material-symbols-outlined" aria-hidden="true">{{ icon }}</span> {{ label }}
  </SettingsButton>
  <!-- The button was an icon and a label, and pressing it started a live session. The sentence is
       the same for every one of them, so it lives here rather than in seven sections (#1564). -->
  <p class="mt-1 text-[11px] text-muted">{{ hint ?? t("settings.skillLaunch.hint") }}</p>
</template>
