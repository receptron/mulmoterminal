<script setup lang="ts">
// What mulmoterminal has left running (#2219): the processes under each session, and the managed
// worktrees that can be removed. Opened from the feature menu. Each tab reads only while it is shown.
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import FullScreenOverlay from "../FullScreenOverlay.vue";
import SessionProcessesPane from "./SessionProcessesPane.vue";
import WorktreeCleanupPane from "./WorktreeCleanupPane.vue";
import { useProcessesView } from "../../composables/useProcessesView";
import { useEscapeToClose } from "../../composables/useEscapeToClose";

const { t } = useI18n();
const { isOpen, close } = useProcessesView();
useEscapeToClose(isOpen, close);

const TABS = ["processes", "worktrees"] as const;
const tab = ref<(typeof TABS)[number]>("processes");
</script>

<template>
  <FullScreenOverlay :open="isOpen" :region-label="t('processesView.region')" :close-label="t('processesView.close')" @close="close">
    <template #header>
      <span class="font-sans text-[14px] font-[650] text-fg">{{ t("processesView.title") }}</span>
      <div class="flex rounded-[4px] border border-border" role="group" :aria-label="t('processesView.tabs')">
        <button
          v-for="choice in TABS"
          :key="choice"
          type="button"
          :data-testid="`processes-tab-${choice}`"
          class="cursor-pointer border-none px-2 py-1 font-sans text-[12px] hover:bg-hover hover:text-fg"
          :class="tab === choice ? 'bg-hover text-fg' : 'bg-transparent text-secondary'"
          :aria-pressed="tab === choice"
          @click="tab = choice"
        >
          {{ t(`processesView.tab.${choice}`) }}
        </button>
      </div>
    </template>

    <SessionProcessesPane v-if="tab === 'processes'" />
    <WorktreeCleanupPane v-else />
  </FullScreenOverlay>
</template>
