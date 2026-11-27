<script setup lang="ts">
// The collection — or the shared app — a build starts from, chosen from the ones the server would accept rather than typed.
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { listSourceCollections, type SourceChoice } from "../../composables/blueprintsApi";
import { failureText } from "./refusalText";
import { onOverlayShownAgain } from "../../composables/overlayVisibility";

defineProps<{ fieldId: string; answer: string }>();
const emit = defineEmits<{ update: [answer: string | undefined] }>();
const { t } = useI18n();

const collections = ref<SourceChoice[] | null>(null);
// Collections first, then shared apps, each under its own heading; a group with nothing in it is not shown.
const KINDS: readonly SourceChoice["kind"][] = ["collection", "app"];
const groups = computed(() =>
  KINDS.map((kind) => ({ kind, choices: (collections.value ?? []).filter((choice) => choice.kind === kind) })).filter((group) => group.choices.length > 0),
);
const error = ref<string | null>(null);

let reads = 0;
/** The collections offered; a re-read that fails keeps the list shown. */
async function read(kept: boolean): Promise<void> {
  const mine = ++reads;
  const result = await listSourceCollections();
  if (mine !== reads || (kept && !result.ok)) return;
  error.value = result.ok ? null : failureText(t, result);
  collections.value = result.ok ? result.value.collections : [];
}
onMounted(() => void read(false));
// The screen is kept while closed; what this shows may have changed in the meantime.
onOverlayShownAgain(() => void read(true));

const onChange = (event: Event): void => {
  if (event.target instanceof HTMLSelectElement) emit("update", event.target.value === "" ? undefined : event.target.value);
};
</script>

<template>
  <div class="flex flex-col gap-1" data-testid="blueprint-collection-picker">
    <select
      :id="fieldId"
      :value="answer"
      class="w-full max-w-[480px] rounded-[4px] border border-border bg-input px-2.5 py-2 font-sans text-[14px] text-fg"
      @change="onChange"
    >
      <option value="" disabled>{{ t("blueprints.form.pickCollection") }}</option>
      <optgroup
        v-for="group in groups"
        :key="group.kind"
        :label="t(group.kind === 'app' ? 'blueprints.form.pickGroupApps' : 'blueprints.form.pickGroupCollections')"
      >
        <option v-for="choice in group.choices" :key="choice.slug" :value="choice.slug">
          {{ group.kind === "app" ? choice.title : `${choice.title} (${choice.slug})` }}
        </option>
      </optgroup>
    </select>
    <p v-if="error" class="m-0 font-sans text-[11px] text-err-text">{{ error }}</p>
    <p v-else-if="collections !== null && collections.length === 0" class="m-0 font-sans text-[11px] text-dim" data-testid="blueprint-collection-none">
      {{ t("blueprints.form.pickCollectionNone") }}
    </p>
  </div>
</template>
