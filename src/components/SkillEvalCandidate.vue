<script setup lang="ts">
// A measured improvement of a skill (#3448): its pass rate beside the skill's own on the same tasks, what
// the writer says it changed, the text itself, and — for a skill that may be edited here — adopting it.
// It was written from and measured on the same tasks, which is why the note about adding new ones stays.
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { CatalogSkill, SkillSource } from "../../common/skillCatalog";
import type { SkillEvalRun } from "../../common/skillEval";
import type { SkillEvalSummary } from "../../common/skillEvalSummary";
import { adoptSkillEvalCandidate } from "../composables/skillEvalApi";

const props = defineProps<{
  source: SkillSource;
  skill: CatalogSkill;
  run: SkillEvalRun;
  summary: SkillEvalSummary;
  baselineSummary: SkillEvalSummary | null;
  editable: boolean;
}>();
const emit = defineEmits<{ adopted: [] }>();
const { t } = useI18n();

const adopting = ref(false);
const adoptNotice = ref<string | null>(null);
const percent = (rate: number | null): string => (rate === null ? "—" : `${String(Math.round(rate * 100))}%`);
const canAdopt = computed(() => props.editable && props.run.status === "done" && props.run.skillText !== "");

async function adopt(): Promise<void> {
  if (adopting.value) return;
  adopting.value = true;
  const adopted = await adoptSkillEvalCandidate(props.source, props.skill.slug, props.run.id).finally(() => (adopting.value = false));
  if (adopted.kind === "adopted") {
    adoptNotice.value = t("skillsView.eval.improve.adopted", { backup: adopted.backup });
    emit("adopted");
  } else if (adopted.kind === "changed") adoptNotice.value = t("skillsView.eval.improve.changed");
  else adoptNotice.value = t("skillsView.eval.improve.adoptFailed", { error: adopted.error });
}
</script>

<template>
  <div data-testid="skill-eval-candidate" class="mb-2 rounded border border-border p-2">
    <p class="m-0 mb-1 text-[13px] font-[650]">{{ t("skillsView.eval.improve.title") }}</p>
    <p v-if="run.skillText === ''" data-testid="skill-eval-candidate-failed" class="m-0 text-err-text">
      {{ t("skillsView.eval.improve.failed", { error: run.note }) }}
    </p>
    <template v-else>
      <p data-testid="skill-eval-compare" class="m-0 mb-1">
        {{ t("skillsView.eval.improve.compare", { before: percent(baselineSummary?.with.passRate ?? null), after: percent(summary.with.passRate) }) }}
      </p>
      <p v-if="run.note" class="m-0 mb-1 whitespace-pre-wrap text-secondary">{{ run.note }}</p>
      <p class="m-0 mb-2 text-dim">{{ t("skillsView.eval.improve.overfit") }}</p>
      <details class="mb-2">
        <summary class="cursor-pointer text-secondary">{{ t("skillsView.eval.improve.show") }}</summary>
        <pre
          data-testid="skill-eval-candidate-text"
          class="m-0 mt-1 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded bg-panel p-2 font-mono text-[11px]"
          >{{ run.skillText }}</pre>
      </details>
      <button
        v-if="canAdopt"
        type="button"
        data-testid="skill-eval-adopt"
        :disabled="adopting"
        class="cursor-pointer rounded border-none bg-accent px-2 py-1 text-[12px] text-white disabled:cursor-default disabled:opacity-60"
        @click="adopt"
      >
        {{ t("skillsView.eval.improve.adopt") }}
      </button>
      <p v-else-if="!editable" class="m-0 text-dim">{{ t("skillsView.eval.improve.readOnly") }}</p>
      <p v-if="adoptNotice" data-testid="skill-eval-adopt-notice" class="m-0 mt-1 text-secondary">{{ adoptNotice }}</p>
    </template>
  </div>
</template>
