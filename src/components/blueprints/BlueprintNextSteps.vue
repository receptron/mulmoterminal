<script setup lang="ts">
// What a finished build may go on to in the same folder (a house style, then writing with it): each opens the
// new-build form with the folder and the answers filled in, so the person only reads and presses Start.
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { listPacks, type PackList } from "../../composables/blueprintsApi";
import { blueprintsViewFollowUp } from "../../composables/useBlueprintsView";
import type { PersonLanguage } from "../../../common/blueprint/personLanguage";
import { nextOptions, usecaseTitle, type NextOption } from "./nextSteps";
import { latestOnly } from "./latestOnly";
import type { HearingAnswers } from "../../../common/blueprint/hearing";
import { onOverlayShownAgain } from "../../composables/overlayVisibility";

// `answers` and `changedFiles`: the finished build's own, for the steps that carry them over.
// `language`: the finished build's report language, which the next one keeps.
const props = defineProps<{
  pair: { base: string; usecase: string };
  projectDir: string;
  answers: HearingAnswers;
  changedFiles: readonly string[];
  language: PersonLanguage | null;
}>();
const { t } = useI18n();

const packs = ref<PackList>([]);
const options = ref<NextOption[]>([]);

const reads = latestOnly();
async function readPacks(): Promise<void> {
  const ticket = reads.take();
  const result = await listPacks();
  if (!reads.isLatest(ticket) || !result.ok) return;
  packs.value = result.value.packs;
  options.value = nextOptions(result.value.packs, props.pair, props.answers, props.changedFiles);
}
onMounted(() => void readPacks());
// The screen is kept while closed; what this shows may have changed in the meantime.
onOverlayShownAgain(() => void readPacks());

function goOn(option: NextOption): void {
  blueprintsViewFollowUp({
    base: props.pair.base,
    usecase: option.usecase,
    answers: option.answers,
    projectDir: props.projectDir,
    after: usecaseTitle(packs.value, props.pair.usecase),
    ...(props.language === null ? {} : { language: props.language }),
  });
}
</script>

<template>
  <section v-if="options.length" class="flex flex-col gap-2" data-testid="blueprint-next-steps">
    <h3 class="m-0 font-sans text-[13px] font-[650] text-fg">{{ t("blueprints.run.nextSteps") }}</h3>
    <p class="m-0 font-sans text-[12px] text-secondary">{{ t("blueprints.run.nextStepsHint") }}</p>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="option in options"
        :key="option.usecase"
        type="button"
        data-testid="blueprint-next-step"
        class="flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-border bg-base px-3 py-1.5 font-sans text-[12px] text-fg hover:bg-hover"
        @click="goOn(option)"
      >
        <span class="material-symbols-outlined text-[15px]" aria-hidden="true">arrow_forward</span>{{ option.title }}
      </button>
    </div>
  </section>
</template>
