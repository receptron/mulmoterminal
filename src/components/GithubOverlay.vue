<script setup lang="ts">
// The full-screen GitHub view: GithubPane in a fixed frame, driven by the /github route
// (useGithubView). Everything about the list lives in GithubPane; what is here is the route
// coupling. `v-if` rather than a hidden element, so entering the view mounts the pane and the
// pane's own onMounted does the fetch.
import { useGithubView } from "../composables/useGithubView";
import { useEscapeToClose } from "../composables/useEscapeToClose";
import GithubPane from "./GithubPane.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const { isOpen, close } = useGithubView();

useEscapeToClose(isOpen, close);
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-(--screen-top) bottom-0 z-50 flex flex-col bg-deep" role="region" :aria-label="t('tips.overlays.github')">
    <GithubPane class="min-h-0 flex-auto" @close="close">
      <template #title>
        <span class="text-[14px] font-[650] text-fg">GitHub</span>
        <span class="text-[12px] text-muted">pull requests &amp; issues</span>
      </template>
    </GithubPane>
  </div>
</template>
