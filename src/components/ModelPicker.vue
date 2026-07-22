<script setup lang="ts">
// Which backend + model a session starts on, chosen at launch (#584). Sits in the empty
// cell's launch form, under the working directory.
//
// The choice lasts for this session only — the directory's .mulmoterminal.json still holds
// the default, and leaving this alone is what uses it. The picker only appears when there
// is something to choose between: with no reachable provider there is no decision to make,
// only setup to explain, so it collapses to a link into the help.
import { computed, ref } from "vue";
import { useLaunchOptions } from "../composables/useLaunchOptions";
import { modelOptionLabel, sortedModels } from "./modelOption";
import ModelSetupHelp from "./ModelSetupHelp.vue";
import type { LaunchChoice } from "./wsUrl";

const props = defineProps<{ modelValue: LaunchChoice | null }>();
const emit = defineEmits<{ (e: "update:modelValue", choice: LaunchChoice | null): void }>();

const { launchOptions } = useLaunchOptions();
const helpOpen = ref(false);

// A provider is only offerable when this server can actually reach it; an unready one is
// left to the help, which names the single thing that is missing.
const readyProviders = computed(() => launchOptions.value.providers.filter((provider) => provider.ready));

// One flat <select>: "<provider>|<model>", empty string for the directory's own default.
const SEPARATOR = "|";
const selected = computed({
  get: () => (props.modelValue?.model ? `${props.modelValue.provider ?? ""}${SEPARATOR}${props.modelValue.model}` : ""),
  set: (value: string) => {
    if (!value) return emit("update:modelValue", null);
    const [provider, model] = value.split(SEPARATOR);
    emit("update:modelValue", { provider: provider || null, model });
  },
});
</script>

<template>
  <div class="flex w-full max-w-[360px] flex-col items-center gap-1.5">
    <span class="flex w-full items-center justify-between">
      <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">Model</span>
      <button
        type="button"
        data-testid="cell-model-help"
        class="cursor-pointer border-none bg-transparent p-0 font-sans text-[11px] text-dim underline hover:text-fg"
        @click="helpOpen = true"
      >
        {{ launchOptions.anyReady ? "How this works" : "Use another model…" }}
      </button>
    </span>

    <select
      v-if="launchOptions.anyReady"
      v-model="selected"
      data-testid="cell-model-select"
      aria-label="Model for this session"
      class="box-border w-full rounded-md border border-border bg-input px-2.5 py-[7px] font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
    >
      <option value="">This directory's default</option>
      <optgroup v-for="provider in readyProviders" :key="provider.id" :label="provider.label">
        <option v-for="model in sortedModels(provider.models)" :key="model.id" :value="`${provider.id}${SEPARATOR}${model.id}`">
          {{ modelOptionLabel(model) }}
        </option>
      </optgroup>
    </select>

    <ModelSetupHelp v-if="helpOpen" :providers="launchOptions.providers" @close="helpOpen = false" />
  </div>
</template>
