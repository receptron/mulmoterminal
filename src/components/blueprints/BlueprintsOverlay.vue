<script setup lang="ts">
// The blueprint builds (#2246): start one from a template, and follow each to the end. A build runs
// its steps as terminals in the grid; this is where a person approves, answers and retries — the
// only things the build ever stops for.
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useBlueprintsView, blueprintsViewMarket, blueprintsViewSelect } from "../../composables/useBlueprintsView";
import { useEscapeToClose } from "../../composables/useEscapeToClose";
import { heldWhileClosed, provideOverlayVisible, useEverOpened } from "../../composables/overlayVisibility";
import { listRuns, type RunList } from "../../composables/blueprintsApi";
import { runGroups } from "./blueprintView";
import BlueprintRunItem from "./BlueprintRunItem.vue";
import BlueprintNewBuild from "./BlueprintNewBuild.vue";
import { latestOnly } from "./latestOnly";
import BlueprintRunView from "./BlueprintRunView.vue";
import BlueprintMarket from "./BlueprintMarket.vue";

// The list only has to notice a build changing hands between the agent and the person.
const LIST_POLL_MS = 3000;

const { t } = useI18n();
const view = useBlueprintsView();
const { isOpen, close } = view;
// Held while closed, so the hidden screen keeps the build it showed instead of switching to the form.
const runId = heldWhileClosed(isOpen, () => view.runId.value);
const inMarket = heldWhileClosed(isOpen, () => view.inMarket.value);
provideOverlayVisible(isOpen);
const everOpened = useEverOpened(isOpen);
// Bumped when the market installs or removes a pack, so the new-build form reads the packs again.
const packsVersion = ref(0);
useEscapeToClose(isOpen, close);

const runs = ref<RunList>([]);
let pollTimer: ReturnType<typeof setInterval> | null = null;
// The screen outlives a close, so a list asked for before it can answer after the next opening's.
const runsRead = latestOnly();

async function refresh(): Promise<void> {
  if (!isOpen.value) return; // a start or an archive answering after the close; the next opening reads
  const ticket = runsRead.take();
  const result = await listRuns();
  if (runsRead.isLatest(ticket) && result.ok) runs.value = result.value.runs;
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
  // A start that answers after the screen was closed must not open it again.
  if (isOpen.value) blueprintsViewSelect(id);
}

const groups = computed(() => runGroups(runs.value));
</script>

<template>
  <div v-if="everOpened" v-show="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 flex flex-col bg-deep" role="region" :aria-label="t('blueprints.title')">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <span class="material-symbols-outlined text-[16px] text-secondary" aria-hidden="true">architecture</span>
      <span class="text-[14px] font-[650] text-fg">{{ t("blueprints.title") }}</span>
      <span class="flex-1"></span>
      <button
        type="button"
        class="h-6 w-[26px] cursor-pointer rounded-md border border-border bg-base text-[14px] text-secondary hover:bg-hover hover:text-fg"
        :data-tip="t('blueprints.close')"
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
          :class="runId === null && !inMarket ? 'bg-hover text-fg' : 'bg-transparent text-secondary'"
          @click="blueprintsViewSelect(null)"
        >
          <span class="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
          {{ t("blueprints.newBuild") }}
        </button>
        <button
          type="button"
          data-testid="blueprint-market-nav"
          class="mb-1 flex cursor-pointer items-center gap-1.5 rounded-[4px] border-none px-2 py-1.5 text-left font-sans text-[12px] hover:bg-hover hover:text-fg"
          :class="inMarket ? 'bg-hover text-fg' : 'bg-transparent text-secondary'"
          @click="blueprintsViewMarket()"
        >
          <span class="material-symbols-outlined text-[16px]" aria-hidden="true">storefront</span>
          {{ t("blueprints.market.nav") }}
        </button>
        <p v-if="!runs.length" class="m-0 px-2 py-2 font-sans text-[12px] text-dim">{{ t("blueprints.noBuilds") }}</p>
        <template v-for="entry in groups" :key="entry.group">
          <!-- Put-away builds stay reachable but closed, so they no longer crowd the builds still in play. -->
          <details v-if="entry.group === 'archived'" class="mt-2" :open="entry.runs.some((summary) => summary.id === runId)" data-testid="blueprint-archived">
            <summary class="cursor-pointer px-2 pb-0.5 font-sans text-[11px] font-[650] text-dim" data-testid="blueprint-run-group">
              {{ t("blueprints.runGroups.archived", { count: entry.runs.length }) }}
            </summary>
            <BlueprintRunItem
              v-for="summary in entry.runs"
              :key="summary.id"
              :summary="summary"
              :selected="summary.id === runId"
              @select="blueprintsViewSelect(summary.id)"
            />
          </details>
          <template v-else>
            <h3 class="m-0 mt-2 px-2 pb-0.5 font-sans text-[11px] font-[650] text-dim" data-testid="blueprint-run-group">
              {{ t(`blueprints.runGroups.${entry.group}`) }}
            </h3>
            <BlueprintRunItem
              v-for="summary in entry.runs"
              :key="summary.id"
              :summary="summary"
              :selected="summary.id === runId"
              @select="blueprintsViewSelect(summary.id)"
            />
          </template>
        </template>
      </nav>

      <section class="min-w-0 flex-1 overflow-y-auto">
        <BlueprintMarket v-if="inMarket" @changed="packsVersion++" />
        <BlueprintRunView v-else-if="runId" :key="runId" :run-id="runId" @archived="refresh" />
        <BlueprintNewBuild v-else :key="packsVersion" @started="onStarted" />
      </section>
    </div>
  </div>
</template>
