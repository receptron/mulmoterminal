<script setup lang="ts">
// Whether one skill actually helps (#3438), under its SKILL.md in the Skills viewer: the test tasks the
// user approved, a Measure button that runs each with and without the skill, and what the runs found.
// The tasks are drafted in a Claude cell by the bundled `mulmoterminal-skill-eval` skill; nothing here
// writes them.
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { CatalogSkill, SkillSource } from "../../common/skillCatalog";
import { freshAttempts, type SkillEvalOverview, type SkillEvalRun, type SkillEvalRunMode } from "../../common/skillEval";
import { summarizeSkillEval, type SkillEvalSummary } from "../../common/skillEvalSummary";
import { compareImprovement } from "../../common/skillEvalCompare";
import { loadSkillEval, startSkillEvalAuthoring, startSkillEvalRun, stopSkillEvalRun } from "../composables/skillEvalApi";
import { placeSpawnedChat } from "../composables/useSpawnedChat";
import SkillEvalResult from "./SkillEvalResult.vue";
import SkillEvalCandidate from "./SkillEvalCandidate.vue";
import SkillEvalLadder from "./SkillEvalLadder.vue";
import SkillEvalHistory from "./SkillEvalHistory.vue";
import { skillEvalNext, type SkillEvalNext, type SkillEvalStep } from "./skillEvalNext";
import { useOverlayVisible } from "../composables/overlayVisibility";

const props = defineProps<{ source: SkillSource; skill: CatalogSkill }>();
const emit = defineEmits<{ adopted: [] }>();
const { t, locale } = useI18n();

// While a run is going, how often its record is read again.
const POLL_MS = 3000;

const overview = shallowRef<SkillEvalOverview | null>(null);
const loadFailed = ref(false);
const notice = ref<string | null>(null);
/** Which start is being confirmed. */
const confirming = ref<SkillEvalRunMode | null>(null);
const drafting = ref(false);
let poll: ReturnType<typeof setInterval> | null = null;
// Bumped when the skill changes or the panel goes: an answer for an earlier skill is dropped.
let selection = 0;

const latest = computed<SkillEvalRun | null>(() => overview.value?.runs[0] ?? null);
const latestSummary = computed<SkillEvalSummary | null>(() =>
  latest.value ? summarizeSkillEval(latest.value.cases, latest.value.attempts, latest.value.repeats) : null,
);
const earlier = computed(() => (overview.value?.runs ?? []).slice(1));
// What the next improvement is written from, and what the measured one is compared with: the run it was written from.
const baseline = computed(() => overview.value?.baseline ?? null);
const comparedWith = computed(() => (overview.value?.runs ?? []).find((run) => run.id === latest.value?.baseRunId) ?? null);
const baselineSummary = computed(() =>
  comparedWith.value ? summarizeSkillEval(comparedWith.value.cases, comparedWith.value.attempts, comparedWith.value.repeats) : null,
);
const comparison = computed(() => (comparedWith.value && latest.value ? compareImprovement(comparedWith.value, latest.value) : null));
// Only while the run goes on: a writer that failed leaves the text empty too, and its cost is still shown.
const improving = computed(() => latest.value?.candidateId != null && latest.value.skillText === "" && overview.value?.activeRunId === latest.value.id);
// The SKILL.md measured last is not the one measured the time before: the two results are of different texts.
const skillTextChanged = computed(() => earlier.value.length > 0 && latest.value?.skillHash !== earlier.value[0]?.skillHash);
const useCount = computed(() => overview.value?.set?.cases.filter((c) => c.kind === "use").length ?? 0);
const avoidCount = computed(() => overview.value?.set?.cases.filter((c) => c.kind === "avoid").length ?? 0);
const confirmText = computed(() => {
  const estimate = overview.value?.estimate;
  if (!estimate) return "";
  if (confirming.value === "ladder") return t("skillsView.eval.ladder.confirm", { attempts: estimate.ladderAttempts, max: usd(estimate.maxLadderCostUsd) });
  if (confirming.value === "improve") return t("skillsView.eval.improve.confirm", { attempts: estimate.improveAttempts, max: usd(estimate.maxImproveCostUsd) });
  return t("skillsView.eval.confirm", { attempts: estimate.attempts, max: usd(estimate.maxCostUsd) });
});
const progressKey = (run: SkillEvalRun): string => {
  if (run.ladder.length > 0) return "skillsView.eval.ladder.running";
  return run.candidateId ? "skillsView.eval.improve.running" : "skillsView.eval.running";
};
const nextStep = computed<SkillEvalNext>(() => (overview.value ? skillEvalNext(overview.value) : { step: null, reason: null }));
// The step to take next stands out; the others stay, quieter, for whoever knows what they want.
const STEP_BUTTON = "cursor-pointer rounded px-2 py-1 text-[12px] disabled:cursor-default disabled:opacity-60";
const stepButton = (step: SkillEvalStep): string =>
  nextStep.value.step === step
    ? `${STEP_BUTTON} border border-accent bg-accent text-white`
    : `${STEP_BUTTON} border border-border bg-transparent text-fg hover:bg-hover`;
const usd = (value: number): string => `$${value.toFixed(2)}`;

function stopPolling(): void {
  if (poll !== null) clearInterval(poll);
  poll = null;
}

async function refresh(): Promise<void> {
  // A stop or an adoption can answer after the panel was hidden; showing it again reads anyway.
  if (!visible.value) return;
  const asked = selection;
  const mine = ++evalReads;
  evalReadsOut += 1;
  const read = await loadSkillEval(props.source, props.skill.slug).finally(() => (evalReadsOut -= 1));
  if (asked !== selection || mine !== evalReads) return;
  // A failed read while a run is shown keeps what is on screen and tries again on the next tick.
  if (read === null) {
    loadFailed.value = overview.value === null;
    if (overview.value === null) stopPolling();
    else if (overview.value.activeRunId !== null) startPolling();
    return;
  }
  overview.value = read;
  loadFailed.value = false;
  if (read.activeRunId === null) stopPolling();
  else startPolling();
}

const visible = useOverlayVisible();
function startPolling(): void {
  // A tick waits for a read still out: a newer one would outdate it, and with slow reads none would land.
  if (visible.value)
    poll ??= setInterval(() => {
      if (evalReadsOut === 0) void refresh();
    }, POLL_MS);
}
// Only the newest read is applied: one from before a hide can answer after the read made on showing
// again. One that answers while hidden is newer than what is shown, so it is kept. A start is not a
// read (`selection` is the skill), so one that answers after showing again is followed.
let evalReads = 0;
let evalReadsOut = 0;
watch(visible, (shown) => (shown ? void refresh() : stopPolling()));

watch(
  () => [props.source, props.skill.id],
  () => {
    selection += 1;
    stopPolling();
    overview.value = null;
    notice.value = null;
    confirming.value = null;
    void refresh();
  },
  { immediate: true },
);
onUnmounted(() => {
  selection += 1;
  stopPolling();
});

async function measure(): Promise<void> {
  const mode = confirming.value ?? "measure";
  confirming.value = null;
  const asked = selection;
  const started = await startSkillEvalRun(props.source, props.skill.slug, mode);
  // Moved to another skill, or the panel is gone: nothing here should start polling.
  if (asked !== selection) return;
  if (started.kind === "busy") notice.value = t("skillsView.eval.busy");
  else if (started.kind === "failed") notice.value = t("skillsView.eval.startFailed", { error: started.error });
  else {
    notice.value = null;
    // Polled from here, not only once a read has seen the run: that read may fail.
    startPolling();
  }
  // Hidden, there is nothing to show it on; showing again reads.
  if (visible.value) await refresh();
}

async function stop(): Promise<void> {
  const id = overview.value?.activeRunId;
  if (id) await stopSkillEvalRun(id);
  await refresh();
}

async function onAdopted(): Promise<void> {
  emit("adopted");
  await refresh();
}

async function draft(): Promise<void> {
  if (drafting.value) return;
  drafting.value = true;
  const chatId = await startSkillEvalAuthoring(props.source, props.skill.slug, locale.value).finally(() => (drafting.value = false));
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
        <button type="button" data-testid="skill-eval-draft" :disabled="drafting" :class="stepButton('draft')" @click="draft">
          {{ overview.setError ? t("skillsView.eval.fix") : t("skillsView.eval.draft") }}
        </button>
      </template>
      <template v-else>
        <p class="m-0 mb-2 text-secondary">
          {{ t("skillsView.eval.setSummary", { use: useCount, avoid: avoidCount, repeats: overview.set.repeats, model: overview.set.model }) }}
        </p>
        <p v-if="nextStep.reason && !confirming" data-testid="skill-eval-next" class="m-0 mb-2 flex items-start gap-1 text-fg">
          <span class="material-symbols-outlined text-[14px] leading-[18px] text-accent" aria-hidden="true">arrow_forward</span
          >{{ t(`skillsView.eval.next.${nextStep.reason}`) }}
        </p>
        <div v-if="overview.activeRunId && latest" data-testid="skill-eval-progress" class="mb-2 flex items-center gap-2">
          <span v-if="improving">{{ t("skillsView.eval.improve.writing") }}</span>
          <span v-else>{{ t(progressKey(latest), { done: freshAttempts(latest).length, total: latest.plannedAttempts }) }}</span>
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
          <p class="m-0 mb-2">{{ confirmText }}</p>
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
              @click="confirming = null"
            >
              {{ t("skillsView.edit.cancel") }}
            </button>
          </div>
        </div>
        <div v-else class="mb-2 flex gap-2">
          <button type="button" data-testid="skill-eval-measure" :class="stepButton('measure')" @click="confirming = 'measure'">
            {{ t("skillsView.eval.measure") }}
          </button>
          <button v-if="baseline" type="button" data-testid="skill-eval-improve" :class="stepButton('improve')" @click="confirming = 'improve'">
            {{ t("skillsView.eval.improve.start") }}
          </button>
          <button
            v-if="overview.estimate && overview.estimate.ladderAttempts > 0"
            type="button"
            data-testid="skill-eval-ladder"
            :class="stepButton('ladder')"
            @click="confirming = 'ladder'"
          >
            {{ t("skillsView.eval.ladder.start") }}
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
      <SkillEvalCandidate
        v-if="latest && latestSummary && latest.candidateId && latest.setHash === overview.setHash && !overview.activeRunId"
        :source="source"
        :skill="skill"
        :run="latest"
        :summary="latestSummary"
        :baseline-summary="baselineSummary"
        :comparison="comparison"
        :editable="overview.editable"
        :base-text="comparedWith?.skillText ?? null"
        @adopted="onAdopted"
      />
      <SkillEvalLadder v-if="latest && latest.ladder.length > 0" :run="latest" />
      <SkillEvalResult v-else-if="latest && latestSummary && !improving" :run="latest" :summary="latestSummary" :skill-text-changed="skillTextChanged" />
      <SkillEvalHistory v-if="earlier.length" :runs="earlier" :current-skill-hash="overview.skillHash" />
      <p class="m-0 mt-2 break-all font-mono text-[10px] text-dim">{{ overview.dir }}</p>
    </template>
  </section>
</template>
