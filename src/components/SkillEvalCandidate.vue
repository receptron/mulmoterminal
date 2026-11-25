<script setup lang="ts">
// A measured improvement of a skill (#3448): its pass rate beside the skill's own on the same tasks, what
// the writer says it changed, the text itself, and — for a skill that may be edited here — adopting it.
// It was written from and measured on the same tasks, which is why the note about adding new ones stays.
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import type { EditorView } from "@codemirror/view";
import { useI18n } from "vue-i18n";
import type { CatalogSkill, SkillSource } from "../../common/skillCatalog";
import type { SkillEvalRun } from "../../common/skillEval";
import type { SkillEvalSummary } from "../../common/skillEvalSummary";
import type { SkillEvalComparison } from "../../common/skillEvalCompare";
import { adoptSkillEvalCandidate } from "../composables/skillEvalApi";
import { createDiffView } from "./cmDiffView";
import { activeThemeVars } from "../composables/useTheme";
import { isLightTheme } from "../../common/themeVars";

const props = defineProps<{
  source: SkillSource;
  skill: CatalogSkill;
  run: SkillEvalRun;
  summary: SkillEvalSummary;
  baselineSummary: SkillEvalSummary | null;
  /** Against the run it was written from, when that run is still listed. */
  comparison: SkillEvalComparison | null;
  editable: boolean;
  /** The SKILL.md the improvement was written from, when that run is still listed. */
  baseText: string | null;
}>();
const emit = defineEmits<{ adopted: [] }>();
const { t, locale } = useI18n();

const adopting = ref(false);
const adoptNotice = ref<string | null>(null);
const percent = (rate: number | null): string => (rate === null ? "—" : `${String(Math.round(rate * 100))}%`);
const CHANGE_TONE: Record<SkillEvalComparison["change"], string> = { better: "text-ok", worse: "text-err-text", "no-evidence": "text-fg", pending: "text-dim" };
const worseTitles = computed(() => {
  const ids = new Set(props.comparison?.worseCaseIds ?? []);
  return props.run.cases.filter((evalCase) => ids.has(evalCase.id)).map((evalCase) => evalCase.title);
});
const canAdopt = computed(() => props.editable && props.run.status === "done" && props.run.skillText !== "");

// The change is shown as the improvement with what it took out in place (#3468): reading that is how someone
// decides to adopt it, and the whole text alone leaves them to compare the two by eye.
const diffHost = useTemplateRef<HTMLElement>("diffHost");
const dark = computed(() => activeThemeVars.value === null || !isLightTheme(activeThemeVars.value));
let diffView: EditorView | null = null;
const clearDiff = (): void => {
  diffView?.destroy();
  diffView = null;
};
watch(
  // The language too: the folded-lines label is fixed when the view is built.
  [diffHost, dark, () => props.baseText, () => props.run.skillText, locale],
  ([host, isDark, baseText, skillText]) => {
    clearDiff();
    if (!host || baseText === null) return;
    // CodeMirror fills `$` with the count; the translation keeps it where its own language wants the number.
    const phrases = { "$ unchanged lines": t("skillsView.eval.improve.folded", { count: "$" }) };
    diffView = createDiffView(host, baseText, skillText, { phrases, dark: isDark });
  },
  { immediate: true },
);
onBeforeUnmount(clearDiff);

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
      <p v-if="comparison" data-testid="skill-eval-change" class="m-0 mb-1" :class="CHANGE_TONE[comparison.change]">
        {{ t(`skillsView.eval.improve.change.${comparison.change}`, { spread: percent(comparison.spread) }) }}
      </p>
      <p v-if="worseTitles.length > 0" data-testid="skill-eval-worse-tasks" class="m-0 mb-1 text-err-text">
        {{ t("skillsView.eval.improve.worseTasks", { tasks: worseTitles.join(", ") }) }}
      </p>
      <p v-if="run.note" class="m-0 mb-1 whitespace-pre-wrap text-secondary">{{ run.note }}</p>
      <p class="m-0 mb-2 text-dim">{{ t("skillsView.eval.improve.overfit") }}</p>
      <template v-if="baseText !== null">
        <p class="m-0 mb-1 text-secondary">{{ t("skillsView.eval.improve.diff") }}</p>
        <div ref="diffHost" data-testid="skill-eval-candidate-diff" class="mb-2 max-h-[40vh] overflow-y-auto rounded border border-border text-[12px]" />
      </template>
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
