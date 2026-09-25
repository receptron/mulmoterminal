<script setup lang="ts">
// One interview question, as the input its kind asks for. The question's WHY is shown under it: the
// answer decides something expensive to change later, and saying so gets a better answer.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { HearingAnswer, HearingQuestion } from "../../../common/blueprint/hearing";
import { answerFromInput, toggleChoice } from "./blueprintView";

const props = defineProps<{ question: HearingQuestion; answer: HearingAnswer | undefined }>();
const emit = defineEmits<{ update: [answer: HearingAnswer | undefined] }>();
const { t } = useI18n();

const fieldId = computed(() => `blueprint-q-${props.question.id}`);
const textValue = computed(() => (typeof props.answer === "string" || typeof props.answer === "number" ? String(props.answer) : ""));
const isChosen = (choice: string): boolean => Array.isArray(props.answer) && props.answer.includes(choice);

const onText = (event: Event): void => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
    emit("update", answerFromInput(props.question, event.target.value));
};
</script>

<template>
  <div class="flex flex-col gap-1" data-testid="blueprint-question">
    <label :for="fieldId" class="font-sans text-[13px] text-fg">
      {{ question.label }}
      <span v-if="!question.required" class="text-[11px] text-dim">({{ t("blueprints.form.optional") }})</span>
    </label>

    <div v-if="question.kind === 'boolean'" :id="fieldId" class="flex gap-1.5" role="radiogroup">
      <button
        v-for="choice in [true, false]"
        :key="String(choice)"
        type="button"
        role="radio"
        :aria-checked="answer === choice"
        class="cursor-pointer rounded-[4px] border px-3 py-1 font-sans text-[12px]"
        :class="answer === choice ? 'border-accent bg-accent-bg text-fg' : 'border-border bg-base text-secondary hover:bg-hover'"
        @click="emit('update', choice)"
      >
        {{ choice ? t("blueprints.form.yes") : t("blueprints.form.no") }}
      </button>
    </div>

    <select
      v-else-if="question.kind === 'select'"
      :id="fieldId"
      :value="textValue"
      class="w-full max-w-[420px] rounded-[4px] border border-border bg-input px-2 py-1.5 font-sans text-[12px] text-fg"
      @change="onText"
    >
      <option value="" disabled>{{ t("blueprints.form.choose") }}</option>
      <option v-for="choice in question.options ?? []" :key="choice" :value="choice">{{ choice }}</option>
    </select>

    <div v-else-if="question.kind === 'multiselect'" :id="fieldId" class="flex flex-wrap gap-1.5">
      <button
        v-for="choice in question.options ?? []"
        :key="choice"
        type="button"
        :aria-pressed="isChosen(choice)"
        class="cursor-pointer rounded-[4px] border px-3 py-1 font-sans text-[12px]"
        :class="isChosen(choice) ? 'border-accent bg-accent-bg text-fg' : 'border-border bg-base text-secondary hover:bg-hover'"
        @click="emit('update', toggleChoice(answer, choice))"
      >
        {{ choice }}
      </button>
    </div>

    <input
      v-else
      :id="fieldId"
      :type="question.kind === 'number' ? 'number' : 'text'"
      :value="textValue"
      class="w-full max-w-[560px] rounded-[4px] border border-border bg-input px-2 py-1.5 font-sans text-[12px] text-fg"
      @input="onText"
    />

    <p class="m-0 font-sans text-[11px] text-dim">{{ question.why }}</p>
  </div>
</template>
