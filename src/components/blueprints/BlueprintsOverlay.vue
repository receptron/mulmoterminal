<script setup lang="ts">
// The blueprint builds (#2246): start one from a template, and follow each to the end. A build runs
// its steps as terminals in the grid; this is where a person approves, answers and retries — the
// only things the build ever stops for.
import { onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useBlueprintsView, blueprintsViewSelect } from "../../composables/useBlueprintsView";
import { useEscapeToClose } from "../../composables/useEscapeToClose";
import { listRuns, type RunList } from "../../composables/blueprintsApi";
import { waitKey } from "./blueprintView";
import BlueprintNewBuild from "./BlueprintNewBuild.vue";
import BlueprintRunView from "./BlueprintRunView.vue";

// The list only has to notice a build changing hands between the agent and the person.
const LIST_POLL_MS = 3000;

const { t } = useI18n();
const { isOpen, runId, close } = useBlueprintsView();
useEscapeToClose(isOpen, close);

const runs = ref<RunList>([]);
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refresh(): Promise<void> {
  const result = await listRuns();
  if (result.ok) runs.value = result.value.runs;
}

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

watch(
  isOpen,
  (open) => {
    stopPolling();
    if (!open) return;
    void refresh();
    pollTimer = setInterval(() => void refresh(), LIST_POLL_MS);
  },
  { immediate: true },
);
onUnmounted(stopPolling);

function onStarted(id: string): void {
  void refresh();
  blueprintsViewSelect(id);
}

const folderName = (dir: string): string => dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir;
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 flex flex-col bg-deep" role="region" :aria-label="t('blueprints.title')">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <span class="material-symbols-outlined text-[16px] text-secondary" aria-hidden="true">architecture</span>
      <span class="text-[14px] font-[650] text-fg">{{ t("blueprints.title") }}</span>
      <span class="flex-1"></span>
      <button
        type="button"
        class="h-6 w-[26px] cursor-pointer rounded-md border border-border bg-base text-[14px] text-secondary hover:bg-hover hover:text-fg"
        :title="t('blueprints.close')"
        :aria-label="t('blueprints.closeAria')"
        @click="close"
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>

    <div class="flex min-h-0 flex-1">
      <nav class="flex w-[280px] flex-none flex-col overflow-y-auto border-r border-border bg-panel p-1" :aria-label="t('blueprints.buildsAria')">
        <button
          type="button"
          data-testid="blueprint-new"
          class="mb-1 flex cursor-pointer items-center gap-1.5 rounded-[4px] border-none px-2 py-1.5 text-left font-sans text-[12px] hover:bg-hover hover:text-fg"
          :class="runId === null ? 'bg-hover text-fg' : 'bg-transparent text-secondary'"
          @click="blueprintsViewSelect(null)"
        >
          <span class="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
          {{ t("blueprints.newBuild") }}
        </button>
        <p v-if="!runs.length" class="m-0 px-2 py-2 font-sans text-[12px] text-dim">{{ t("blueprints.noBuilds") }}</p>
        <button
          v-for="summary in runs"
          :key="summary.id"
          type="button"
          data-testid="blueprint-run-item"
          class="flex cursor-pointer flex-col gap-0.5 rounded-[4px] border-none px-2 py-1.5 text-left hover:bg-hover"
          :class="summary.id === runId ? 'bg-hover' : 'bg-transparent'"
          :title="summary.projectDir"
          @click="blueprintsViewSelect(summary.id)"
        >
          <span class="truncate font-mono text-[12px] text-fg">{{ folderName(summary.projectDir) }}</span>
          <span class="truncate font-sans text-[11px] text-secondary">{{ summary.current ? summary.current.title : t("blueprints.done") }}</span>
          <span v-if="waitKey(summary.waitingOn)" class="font-sans text-[11px] text-warn">{{ t(waitKey(summary.waitingOn) ?? "") }}</span>
          <span v-else class="font-sans text-[11px] text-dim">{{ t("blueprints.progress", { passed: summary.passed, total: summary.total }) }}</span>
        </button>
      </nav>

      <section class="min-w-0 flex-1 overflow-y-auto">
        <BlueprintRunView v-if="runId" :key="runId" :run-id="runId" />
        <BlueprintNewBuild v-else @started="onStarted" />
      </section>
    </div>
  </div>
</template>
