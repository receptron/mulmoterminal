<script setup lang="ts">
// The earlier runs of a skill's evaluation (#3469), newest first: one line each with the pass rates, so the
// lines read as how the skill moved from version to version, and each opens to the result as it was shown then.
import { useI18n } from "vue-i18n";
import type { SkillEvalRun } from "../../common/skillEval";
import { summarizeLadder } from "../../common/skillEvalLadder";
import { summarizeSkillEval, type SkillEvalSummary } from "../../common/skillEvalSummary";
import SkillEvalResult from "./SkillEvalResult.vue";
import SkillEvalLadder from "./SkillEvalLadder.vue";

const props = defineProps<{ runs: SkillEvalRun[]; currentSkillHash: string | null }>();
const { t, locale } = useI18n();

const percent = (rate: number | null): string => (rate === null ? "—" : `${String(Math.round(rate * 100))}%`);
const when = (at_ms: number): string => new Date(at_ms).toLocaleString(locale.value, { dateStyle: "short", timeStyle: "short" });
const summaryOf = (run: SkillEvalRun): SkillEvalSummary => summarizeSkillEval(run.cases, run.attempts, run.repeats);

/** A search names the model it found; a measurement its pass rates and verdict. */
function headline(run: SkillEvalRun): string {
  if (run.ladder.length === 0) {
    const summary = summaryOf(run);
    const rates = t("skillsView.eval.history.rates", { with: percent(summary.with.passRate), without: percent(summary.without.passRate) });
    return [rates, t(`skillsView.eval.verdict.${summary.verdict}`)].join(" · ");
  }
  const { enough, finished } = summarizeLadder(run.ladder, run.attempts, run.status === "done");
  if (!finished) return t("skillsView.eval.ladder.unfinishedShort");
  return enough === null ? t("skillsView.eval.ladder.noneShort") : t("skillsView.eval.ladder.enoughShort", { model: enough });
}

// An improvement measured its own text, which is the current one only once adopted; that is not news.
const measuredOtherText = (run: SkillEvalRun): boolean =>
  run.candidateId === null && props.currentSkillHash !== null && run.skillHash !== props.currentSkillHash;
</script>

<template>
  <details class="mt-2">
    <summary class="cursor-pointer text-secondary">{{ t("skillsView.eval.earlier", { count: runs.length }) }}</summary>
    <ul class="m-0 mt-1 list-none p-0">
      <li v-for="run in runs" :key="run.id" data-testid="skill-eval-earlier" class="py-0.5">
        <details>
          <summary class="cursor-pointer text-secondary hover:text-fg">
            {{ when(run.startedAt) }} · {{ headline(run) }} · {{ t(`skillsView.eval.status.${run.status}`)
            }}<template v-if="run.candidateId"> · {{ t("skillsView.eval.improve.tag") }}</template
            ><template v-if="run.ladder.length > 0"> · {{ t("skillsView.eval.ladder.tag") }}</template
            ><span v-if="measuredOtherText(run)" data-testid="skill-eval-earlier-other-text"> · {{ t("skillsView.eval.history.otherText") }}</span>
          </summary>
          <div class="mt-1 mb-2 pl-3">
            <SkillEvalLadder v-if="run.ladder.length > 0" :run="run" />
            <SkillEvalResult v-else :run="run" :summary="summaryOf(run)" :skill-text-changed="false" />
          </div>
        </details>
      </li>
    </ul>
  </details>
</template>
