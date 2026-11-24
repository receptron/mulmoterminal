<script setup lang="ts">
// One skill evaluation's result (#3438): the verdict in a sentence, the two arms side by side, how
// often the skill was read and stayed out of the avoid task, and each task's passes.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { SkillEvalAttempt, SkillEvalRun } from "../../common/skillEval";
import type { SkillEvalSummary } from "../../common/skillEvalSummary";

const props = defineProps<{ run: SkillEvalRun; summary: SkillEvalSummary; skillTextChanged: boolean }>();
const { t } = useI18n();

const VERDICT_TONE: Record<SkillEvalSummary["verdict"], string> = { helps: "text-ok", hurts: "text-err-text", "no-evidence": "text-fg", pending: "text-dim" };
const percent = (rate: number | null): string => (rate === null ? "—" : `${String(Math.round(rate * 100))}%`);
const usd = (value: number | null): string => (value === null ? "—" : `$${value.toFixed(3)}`);

const perCase = computed(() =>
  props.run.cases.map((evalCase) => {
    const of = (arm: "with" | "without") => props.run.attempts.filter((a) => a.caseId === evalCase.id && a.arm === arm);
    // With the skill, a use task counts only when the skill ran, and an avoid task only when it did not.
    const counts = (a: SkillEvalAttempt): boolean => a.pass && (a.arm === "without" || a.skillInvoked === (evalCase.kind === "use"));
    const passed = (arm: "with" | "without") => of(arm).filter(counts).length;
    return {
      evalCase,
      withText: `${String(passed("with"))}/${String(of("with").length)}`,
      withoutText: evalCase.kind === "use" ? `${String(passed("without"))}/${String(of("without").length)}` : "",
    };
  }),
);
</script>

<template>
  <div data-testid="skill-eval-result" class="rounded border border-border p-2">
    <p class="m-0 mb-1 text-[13px] font-[650]" :class="VERDICT_TONE[summary.verdict]" data-testid="skill-eval-verdict">
      {{ t(`skillsView.eval.verdict.${summary.verdict}`) }}
    </p>
    <p class="m-0 mb-2 text-secondary">{{ t(`skillsView.eval.verdictWhy.${summary.verdict}`, { spread: percent(summary.spread) }) }}</p>
    <table class="mb-2 w-full border-collapse text-left">
      <thead>
        <tr class="text-dim">
          <th class="py-0.5 font-normal"></th>
          <th class="py-0.5 font-normal">{{ t("skillsView.eval.withSkill") }}</th>
          <th class="py-0.5 font-normal">{{ t("skillsView.eval.withoutSkill") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="py-0.5 text-secondary">{{ t("skillsView.eval.passRate") }}</td>
          <td class="py-0.5" data-testid="skill-eval-with-rate">{{ percent(summary.with.passRate) }}</td>
          <td class="py-0.5" data-testid="skill-eval-without-rate">{{ percent(summary.without.passRate) }}</td>
        </tr>
        <tr>
          <td class="py-0.5 text-secondary">{{ t("skillsView.eval.costPerPass") }}</td>
          <td class="py-0.5">{{ usd(summary.with.costPerPassUsd) }}</td>
          <td class="py-0.5">{{ usd(summary.without.costPerPassUsd) }}</td>
        </tr>
      </tbody>
    </table>
    <ul class="m-0 mb-2 list-disc pl-4 text-secondary">
      <li>{{ t("skillsView.eval.invokeRate", { rate: percent(summary.invokeRate) }) }}</li>
      <li v-if="summary.passesWithoutInvoking > 0">{{ t("skillsView.eval.passedUnread", { count: summary.passesWithoutInvoking }) }}</li>
      <li v-if="summary.avoid.attempts > 0">{{ t("skillsView.eval.avoid", { invoked: summary.avoid.invoked, attempts: summary.avoid.attempts }) }}</li>
      <li v-if="summary.fewCases">{{ t("skillsView.eval.fewCases") }}</li>
      <li v-if="skillTextChanged">{{ t("skillsView.eval.skillChanged") }}</li>
      <li>{{ t("skillsView.eval.spent", { cost: usd(summary.with.costUsd + summary.without.costUsd + summary.avoid.costUsd + summary.gradingCostUsd) }) }}</li>
    </ul>
    <details>
      <summary class="cursor-pointer text-secondary">{{ t("skillsView.eval.perCase") }}</summary>
      <table class="mt-1 w-full border-collapse text-left">
        <tbody>
          <tr v-for="row in perCase" :key="row.evalCase.id" data-testid="skill-eval-case">
            <td class="py-0.5 pr-2">
              {{ row.evalCase.title }}<span v-if="row.evalCase.kind === 'avoid'" class="ml-1 text-dim">{{ t("skillsView.eval.avoidTag") }}</span>
            </td>
            <td class="py-0.5 pr-2">{{ row.withText }}</td>
            <td class="py-0.5">{{ row.withoutText }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>
