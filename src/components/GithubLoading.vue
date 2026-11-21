<script setup lang="ts">
// A GitHub view's first read, shown where its content will be (#3378): each read is several `gh`
// calls per repo, so an empty page would otherwise sit there for seconds looking like "nothing".
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <p data-testid="github-loading" role="status" class="flex items-center gap-2 px-1 py-6 text-[13px] text-muted">
    <span class="material-symbols-outlined animate-spin text-[18px]" aria-hidden="true">progress_activity</span>
    {{ t("githubBoard.loading") }}
  </p>
</template>
