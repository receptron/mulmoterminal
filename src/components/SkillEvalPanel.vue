<script setup lang="ts">
// Whether one skill actually helps (#3438), under its SKILL.md in the Skills viewer: the test tasks the
// user approved, a Measure button that runs each with and without the skill, and what the runs found.
// The tasks are drafted in a Claude cell by the bundled `mulmoterminal-skill-eval` skill; nothing here
// writes them.
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { CatalogSkill, SkillSource } from "../../common/skillCatalog";
import type { SkillEvalOverview, SkillEvalRun } from "../../common/skillEval";
import { summarizeSkillEval, type SkillEvalSummary } from "../../common/skillEvalSummary";
import { loadSkillEval, startSkillEvalAuthoring, startSkillEvalRun, stopSkillEvalRun } from "../composables/skillEvalApi";
import { placeSpawnedChat } from "../composables/useSpawnedChat";
import SkillEvalResult from "./SkillEvalResult.vue";

const props = defineProps<{ source: SkillSource; skill: CatalogSkill }>();
const { t, locale } = useI18n();

// While a run is going, how often its record is read again.
const POLL_MS = 3000;

const overview = shallowRef<SkillEvalOverview | null>(null);
const loadFailed = ref(false);
const notice = ref<string | null>(null);
const confirming = ref(false);
const drafting = ref(false);
let poll: ReturnType<typeof setInterval> | null = null;
// Bumped when the skill changes or the panel goes: an answer for an earlier skill is dropped.
let selection = 0;

const latest = computed<SkillEvalRun | null>(() => overview.value?.runs[0] ?? null);
const latestSummary = computed<SkillEvalSummary | null>(() =>
  latest.value ? summarizeSkillEval(latest.value.cases, latest.value.attempts, latest.value.repeats) : null,
);
const earlier = computed(() => (overview.value?.runs ?? []).slice(1));
// The SKILL.md measured last is not the one measured the time before: the two results are of different texts.
const skillTextChanged = computed(() => earlier.value.length > 0 && latest.value?.skillHash !== earlier.value[0]?.skillHash);
const useCount = computed(() => overview.value?.set?.cases.filter((c) => c.kind === "use").length ?? 0);
const avoidCount = computed(() => overview.value?.set?.cases.filter((c) => c.kind === "avoid").length ?? 0);
const usd = (value: number): string => `$${value.toFixed(2)}`;
const when = (at_ms: number): string => new Date(at_ms).toLocaleString(locale.value, { dateStyle: "short", timeStyle: "short" });

function stopPolling(): void {
  if (poll !== null) clearInterval(poll);
  poll = null;
}

async function refresh(): Promise<void> {
  const asked = selection;
  const read = await loadSkillEval(props.source, props.skill.slug);
  if (asked !== selection) return;
  // A failed read while a run is shown keeps what is on screen and tries again on the next tick.
  if (read === null) {
    loadFailed.value = overview.value === null;
    if (overview.value === null) stopPolling();
    return;
  }
  overview.value = read;
  loadFailed.value = false;
  if (read.activeRunId === null) stopPolling();
  else startPolling();
}

function startPolling(): void {
  poll ??= setInterval(() => void refresh(), POLL_MS);
}

watch(
  () => [props.source, props.skill.id],
  () => {
    selection += 1;
    stopPolling();
    overview.value = null;
    notice.value = null;
    confirming.value = false;
    void refresh();
  },
  { immediate: true },
);
onUnmounted(() => {
  selection += 1;
  stopPolling();
});

async function measure(): Promise<void> {
  confirming.value = false;
  const asked = selection;
  const started = await startSkillEvalRun(props.source, props.skill.slug);
  // Moved to another skill, or the panel is gone: nothing here should start polling.
  if (asked !== selection) return;
  if (started.kind === "busy") notice.value = t("skillsView.eval.busy");
  else if (started.kind === "failed") notice.value = t("skillsView.eval.startFailed", { error: started.error });
  else {
    notice.value = null;
    // Polled from here, not only once a read has seen the run: that read may fail.
    startPolling();
  }
  await refresh();
}

async function stop(): Promise<void> {
  const id = overview.value?.activeRunId;
  if (id) await stopSkillEvalRun(id);
  await refresh();
}

async function draft(): Promise<void> {
  if (drafting.value) return;
  drafting.value = true;
  const chatId = await startSkillEvalAuthoring(props.source, props.skill.slug).finally(() => (drafting.value = false));
  if (chatId === null) {
    notice.value = t("skillsView.eval.draftFailed");
    return;
  }
  // The skill asks before it writes anything, so the cell runs at once rather than as a draft.
  placeSpawnedChat({ id: chatId, agent: "claude", draft: false });
  notice.value = t("skillsView.eval.draftStarted");
}
</script>

<template>
  <section data-testid="skill-eval" class="mb-4 max-w-[90ch] rounded-[6px] border border-border p-3 font-sans text-[12px] text-fg">
    <h3 class="m-0 mb-2 flex items-center gap-1.5 text-[13px] font-[650]">
      <span class="material-symbols-outlined text-[16px] text-dim" aria-hidden="true">science</span>{{ t("skillsView.eval.title") }}
    </h3>
    <p v-if="loadFailed" class="m-0 text-err-text">{{ t("skillsView.eval.loadFailed") }}</p>
    <p v-else-if="!overview" class="m-0 text-dim">{{ t("skillsView.loading") }}</p>
    <template v-else>
      <template v-if="!overview.set">
        <p v-if="overview.setError" data-testid="skill-eval-set-error" class="m-0 mb-2 text-err-text">
          {{ t("skillsView.eval.setError", { error: overview.setError }) }}
        </p>
        <p v-else class="m-0 mb-2 text-secondary">{{ t("skillsView.eval.intro") }}</p>
        <button
          type="button"
          data-testid="skill-eval-draft"
          :disabled="drafting"
          class="cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-[12px] text-fg hover:bg-hover disabled:cursor-default disabled:opacity-60"
          @click="draft"
        >
          {{ overview.setError ? t("skillsView.eval.fix") : t("skillsView.eval.draft") }}
        </button>
      </template>
      <template v-else>
        <p class="m-0 mb-2 text-secondary">
          {{ t("skillsView.eval.setSummary", { use: useCount, avoid: avoidCount, repeats: overview.set.repeats, model: overview.set.model }) }}
        </p>
        <div v-if="overview.activeRunId && latest" data-testid="skill-eval-progress" class="mb-2 flex items-center gap-2">
          <span>{{ t("skillsView.eval.running", { done: latest.attempts.length, total: latest.plannedAttempts }) }}</span>
          <button
            type="button"
            data-testid="skill-eval-stop"
            class="cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-[12px] text-secondary hover:text-fg"
            @click="stop"
          >
            {{ t("skillsView.eval.stop") }}
          </button>
        </div>
        <div v-else-if="confirming && overview.estimate" data-testid="skill-eval-confirm" class="mb-2 rounded border border-border bg-panel p-2">
          <p class="m-0 mb-2">{{ t("skillsView.eval.confirm", { attempts: overview.estimate.attempts, max: usd(overview.estimate.maxCostUsd) }) }}</p>
          <div class="flex gap-2">
            <button
              type="button"
              data-testid="skill-eval-go"
              class="cursor-pointer rounded border-none bg-accent px-2 py-1 text-[12px] text-white"
              @click="measure"
            >
              {{ t("skillsView.eval.go") }}
            </button>
            <button
              type="button"
              class="cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-[12px] text-secondary"
              @click="confirming = false"
            >
              {{ t("skillsView.edit.cancel") }}
            </button>
          </div>
        </div>
        <div v-else class="mb-2 flex gap-2">
          <button
            type="button"
            data-testid="skill-eval-measure"
            class="cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-[12px] text-fg hover:bg-hover"
            @click="confirming = true"
          >
            {{ t("skillsView.eval.measure") }}
          </button>
          <button
            type="button"
            data-testid="skill-eval-draft"
            :disabled="drafting"
            class="cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-[12px] text-secondary hover:text-fg"
            @click="draft"
          >
            {{ t("skillsView.eval.edit") }}
          </button>
        </div>
      </template>
      <p v-if="notice" data-testid="skill-eval-notice" class="m-0 mb-2 text-secondary">{{ notice }}</p>
      <SkillEvalResult v-if="latest && latestSummary" :run="latest" :summary="latestSummary" :skill-text-changed="skillTextChanged" />
      <details v-if="earlier.length" class="mt-2">
        <summary class="cursor-pointer text-secondary">{{ t("skillsView.eval.earlier", { count: earlier.length }) }}</summary>
        <ul class="m-0 mt-1 list-none p-0">
          <li v-for="run in earlier" :key="run.id" data-testid="skill-eval-earlier" class="py-0.5 text-secondary">
            {{ when(run.startedAt) }} · {{ t(`skillsView.eval.verdict.${summarizeSkillEval(run.cases, run.attempts, run.repeats).verdict}`) }} ·
            {{ t(`skillsView.eval.status.${run.status}`) }}
          </li>
        </ul>
      </details>
      <p class="m-0 mt-2 break-all font-mono text-[10px] text-dim">{{ overview.dir }}</p>
    </template>
  </section>
</template>
