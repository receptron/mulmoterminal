<script setup lang="ts">
// What a search for the cheapest model that is enough for a skill found (#3453): each model's pass rate
// with the skill and its cost per pass, cheapest first, and the model the rule picks. A model above one
// that passed everything was never measured, and the row says so rather than reading as a failure.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { SkillEvalRun } from "../../common/skillEval";
import { summarizeLadder } from "../../common/skillEvalLadder";

const props = defineProps<{ run: SkillEvalRun }>();
const { t } = useI18n();

const summary = computed(() => summarizeLadder(props.run.ladder, props.run.attempts, props.run.status === "done"));
const verdict = computed(() => {
  if (!summary.value.finished) return t("skillsView.eval.ladder.unfinished");
  return summary.value.enough ? t("skillsView.eval.ladder.enough", { model: summary.value.enough }) : t("skillsView.eval.ladder.none");
});
const spentUsd = computed(() => summary.value.steps.reduce((total, step) => total + step.costUsd, 0) + summary.value.gradingCostUsd);
// Why a model has no result: not reached yet, skipped because a cheaper one passed everything, or never
// reached because the search ended early. Only a search that finished skips a model.
const notMeasuredText = computed(() => {
  if (props.run.status === "running") return t("skillsView.eval.ladder.pending");
  return t(props.run.status === "done" ? "skillsView.eval.ladder.notMeasured" : "skillsView.eval.ladder.notReached");
});
const percent = (rate: number | null): string => (rate === null ? "—" : `${String(Math.round(rate * 100))}%`);
const usd = (value: number | null): string => (value === null ? "—" : `$${value.toFixed(3)}`);
</script>

<template>
  <div data-testid="skill-eval-ladder-result" class="rounded border border-border p-2">
    <p class="m-0 mb-1 text-[13px] font-[650]">{{ t("skillsView.eval.ladder.title") }}</p>
    <p v-if="run.status !== 'running'" data-testid="skill-eval-ladder-enough" class="m-0 mb-2" :class="summary.enough ? 'text-ok' : 'text-fg'">
      {{ verdict }}
    </p>
    <table class="mb-2 w-full border-collapse text-left">
      <thead>
        <tr class="text-dim">
          <th class="py-0.5 font-normal">{{ t("skillsView.eval.ladder.model") }}</th>
          <th class="py-0.5 font-normal">{{ t("skillsView.eval.passRate") }}</th>
          <th class="py-0.5 font-normal">{{ t("skillsView.eval.costPerPass") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="step in summary.steps" :key="step.model" data-testid="skill-eval-ladder-step">
          <td class="py-0.5 pr-2 font-mono">{{ step.model }}</td>
          <template v-if="step.measured">
            <td class="py-0.5 pr-2">{{ percent(step.passRate) }} ({{ step.passes }}/{{ step.attempts }})</td>
            <td class="py-0.5">{{ usd(step.costPerPassUsd) }}</td>
          </template>
          <td v-else colspan="2" class="py-0.5 text-dim">{{ notMeasuredText }}</td>
        </tr>
      </tbody>
    </table>
    <ul class="m-0 list-disc pl-4 text-secondary">
      <li v-if="run.interruptedBy" data-testid="skill-eval-interrupted-by" class="text-err-text">
        {{ t("skillsView.eval.interruptedBy", { reason: run.interruptedBy }) }}
      </li>
      <li v-if="summary.shaky">{{ t("skillsView.eval.ladder.shaky") }}</li>
      <li>{{ t("skillsView.eval.ladder.hint") }}</li>
      <li>{{ t("skillsView.eval.spent", { cost: usd(spentUsd) }) }}</li>
    </ul>
  </div>
</template>
