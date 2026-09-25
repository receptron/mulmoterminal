<script setup lang="ts">
// Starting a build: where it goes, which template, and the template's interview. Nothing starts until
// every question that applies is answered — the first step writes the spec from these answers, and a
// gap here is a guess there.
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { listPacks, previewPair, startRun, type PackList, type PairPreview } from "../../composables/blueprintsApi";
import { askedQuestions, unansweredQuestions, type HearingAnswer, type HearingAnswers } from "../../../common/blueprint/hearing";
import { basePacks, usecasesFor } from "./blueprintView";
import { latestOnly } from "./latestOnly";
import BlueprintHearingField from "./BlueprintHearingField.vue";

const emit = defineEmits<{ started: [runId: string] }>();
const { t } = useI18n();

const packs = ref<PackList>([]);
const base = ref("");
const usecase = ref("");
const preview = ref<PairPreview | null>(null);
const answers = ref<HearingAnswers>({});
const projectDir = ref("");
const error = ref<string | null>(null);
const starting = ref(false);
const previews = latestOnly();

const bases = computed(() => basePacks(packs.value));
const usecases = computed(() => usecasesFor(packs.value, base.value));
const questions = computed(() => (preview.value ? askedQuestions(preview.value.hearing, answers.value) : []));
const ready = computed(
  () => !starting.value && projectDir.value.trim() !== "" && preview.value !== null && unansweredQuestions(preview.value.hearing, answers.value).length === 0,
);

onMounted(async () => {
  const result = await listPacks();
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  packs.value = result.value.packs;
  base.value = bases.value[0]?.slug ?? "";
});

watch(base, () => {
  usecase.value = usecases.value[0]?.slug ?? "";
});

watch([base, usecase], async ([baseSlug, usecaseSlug]) => {
  preview.value = null;
  answers.value = {};
  error.value = null;
  // Taken before the guard: an empty pair must still outdate the preview it replaces.
  const ticket = previews.take();
  if (!baseSlug || !usecaseSlug) return;
  const result = await previewPair(baseSlug, usecaseSlug);
  if (!previews.isLatest(ticket)) return;
  preview.value = result.ok ? result.value : null;
  error.value = result.ok ? null : result.error;
});

function setAnswer(id: string, answer: HearingAnswer | undefined): void {
  const others = Object.fromEntries(Object.entries(answers.value).filter(([key]) => key !== id));
  answers.value = answer === undefined ? others : { ...others, [id]: answer };
}

async function start(): Promise<void> {
  if (!ready.value) return;
  starting.value = true;
  const result = await startRun({ projectDir: projectDir.value.trim(), base: base.value, usecase: usecase.value, answers: answers.value });
  starting.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  error.value = null;
  emit("started", result.value.runId);
}
</script>

<template>
  <form class="flex max-w-[760px] flex-col gap-5 p-5" data-testid="blueprint-new-form" @submit.prevent="start">
    <h2 class="m-0 font-sans text-[16px] font-[650] text-fg">{{ t("blueprints.form.title") }}</h2>

    <div class="flex flex-col gap-1">
      <label for="blueprint-project-dir" class="font-sans text-[13px] text-fg">{{ t("blueprints.form.projectDir") }}</label>
      <input
        id="blueprint-project-dir"
        v-model="projectDir"
        data-testid="blueprint-project-dir"
        class="w-full rounded-[4px] border border-border bg-input px-2 py-1.5 font-mono text-[12px] text-fg"
        spellcheck="false"
      />
      <p class="m-0 font-sans text-[11px] text-dim">{{ t("blueprints.form.projectDirHint") }}</p>
    </div>

    <div class="flex flex-wrap gap-4">
      <label class="flex flex-col gap-1 font-sans text-[13px] text-fg">
        {{ t("blueprints.form.base") }}
        <select v-model="base" data-testid="blueprint-base" class="min-w-[200px] rounded-[4px] border border-border bg-input px-2 py-1.5 text-[12px] text-fg">
          <option v-for="pack in bases" :key="pack.slug" :value="pack.slug">{{ pack.manifest.title }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 font-sans text-[13px] text-fg">
        {{ t("blueprints.form.usecase") }}
        <select
          v-model="usecase"
          data-testid="blueprint-usecase"
          class="min-w-[200px] rounded-[4px] border border-border bg-input px-2 py-1.5 text-[12px] text-fg"
        >
          <option v-for="pack in usecases" :key="pack.slug" :value="pack.slug">{{ pack.manifest.title }}</option>
        </select>
      </label>
    </div>
    <p v-if="base && !usecases.length" class="m-0 font-sans text-[12px] text-dim">{{ t("blueprints.form.noUsecase") }}</p>

    <template v-if="preview">
      <fieldset class="m-0 flex flex-col gap-4 border-0 p-0">
        <legend class="mb-3 font-sans text-[14px] font-[650] text-fg">{{ t("blueprints.form.questions") }}</legend>
        <BlueprintHearingField
          v-for="question in questions"
          :key="question.id"
          :question="question"
          :answer="answers[question.id]"
          @update="(answer) => setAnswer(question.id, answer)"
        />
      </fieldset>

      <details class="font-sans text-[12px] text-secondary">
        <summary class="cursor-pointer">{{ t("blueprints.form.steps") }}</summary>
        <ol class="m-0 mt-2 pl-5">
          <li v-for="step in preview.steps" :key="step.id" class="mb-0.5">{{ step.title }}</li>
        </ol>
      </details>
    </template>

    <p v-if="error" data-testid="blueprint-new-error" class="m-0 font-sans text-[12px] text-err-text">{{ error }}</p>

    <div>
      <button
        type="submit"
        data-testid="blueprint-start"
        class="cursor-pointer rounded-[4px] border-none bg-accent px-4 py-1.5 font-sans text-[13px] text-on-accent hover:bg-accent-bg-hover disabled:cursor-default disabled:opacity-40"
        :disabled="!ready"
      >
        {{ starting ? t("blueprints.form.starting") : t("blueprints.form.start") }}
      </button>
    </div>
  </form>
</template>
