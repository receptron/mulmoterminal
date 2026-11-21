<script setup lang="ts">
// Beside a repo's name on the board and the PR / issue lists: read only because a terminal is open in it.
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <span class="rounded border border-border px-1.5 font-sans text-[11px] font-normal text-muted" :data-tip="t('githubBoard.unregisteredTip')">{{
    t("githubBoard.unregistered")
  }}</span>
</template>
