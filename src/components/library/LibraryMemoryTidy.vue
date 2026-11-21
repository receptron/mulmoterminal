<script setup lang="ts">
// "Ask for a tidy-up" on a project in the Library's Memory (#3334): starts the bundled skill, in plan
// mode in the project's directory, to propose merging, removing, fixing or moving that project's
// memories; nothing is written until the plan is approved. The refusal, if any, is said beside it.
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { startMemoryTidy } from "./libraryPromoteStart";

const props = defineProps<{ slug: string }>();
const { t } = useI18n();
const refusal = ref<string | null>(null);
const starting = ref(false);

async function ask(): Promise<void> {
  if (starting.value) return;
  starting.value = true;
  refusal.value = null;
  const refused = await startMemoryTidy(props.slug);
  starting.value = false;
  refusal.value = refused === null ? null : t(refused);
}
</script>

<template>
  <span class="flex flex-none items-center gap-1 font-normal normal-case">
    <span v-if="refusal" class="text-err-text" role="status" data-testid="memory-tidy-refused">{{ refusal }}</span>
    <button
      type="button"
      class="flex cursor-pointer items-center border-0 bg-transparent p-0 text-dim hover:text-fg disabled:cursor-default disabled:opacity-60"
      :disabled="starting"
      :aria-label="t('libraryView.memory.tidyAsk.label')"
      :data-tip="t('libraryView.memory.tidyAsk.tip')"
      :data-testid="`memory-tidy-ask-${slug}`"
      @click="ask"
    >
      <span class="material-symbols-outlined text-[16px]">auto_fix_high</span>
    </button>
  </span>
</template>
