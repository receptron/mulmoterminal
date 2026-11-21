<script setup lang="ts">
// "Ask for a tidy-up" on a project in the Library's Memory (#3334): starts the bundled skill, in plan
// mode in the project's directory, to propose merging, removing, fixing or moving that project's
// memories; nothing is written until the plan is approved. Why it was refused, if it was, goes to the
// heading's owner (`refused`), which says it under the heading: beside it there is no room.
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { startMemoryTidy } from "./libraryPromoteStart";

const props = defineProps<{ slug: string }>();
const emit = defineEmits<{ refused: [sentence: string | null] }>();
const { t } = useI18n();
const starting = ref(false);

async function ask(): Promise<void> {
  if (starting.value) return;
  starting.value = true;
  emit("refused", null);
  const refused = await startMemoryTidy(props.slug);
  starting.value = false;
  emit("refused", refused === null ? null : t(refused));
}
</script>

<template>
  <button
    type="button"
    class="flex flex-none cursor-pointer items-center border-0 bg-transparent p-0 font-normal normal-case text-dim hover:text-fg disabled:cursor-default disabled:opacity-60"
    :disabled="starting"
    :aria-label="t('libraryView.memory.tidyAsk.label')"
    :data-tip="t('libraryView.memory.tidyAsk.tip')"
    :data-testid="`memory-tidy-ask-${slug}`"
    @click="ask"
  >
    <span class="material-symbols-outlined text-[16px]">auto_fix_high</span>
  </button>
</template>
