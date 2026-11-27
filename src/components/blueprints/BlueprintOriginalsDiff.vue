<script setup lang="ts">
// What a finished build changed in each document it kept an original of: the file as it is now, with what was taken
// out shown in place, so the person reads the change and the sentences around it here rather than in another view.
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import type { EditorView } from "@codemirror/view";
import { useI18n } from "vue-i18n";
import { loadOriginals } from "../../composables/blueprintsApi";
import type { OriginalsView } from "../../../common/blueprint/originals";
import { ORIGINALS_DIR } from "../../../common/blueprint/originals";
import { createDiffView } from "../cmDiffView";
import { latestOnly } from "./latestOnly";
import { activeThemeVars } from "../../composables/useTheme";
import { isLightTheme } from "../../../common/themeVars";
import { onOverlayShownAgain } from "../../composables/overlayVisibility";

const props = defineProps<{ runId: string }>();
const { t } = useI18n();
const originals = ref<OriginalsView | null>(null);
const hosts = useTemplateRef<HTMLElement[]>("diffHost");
const reads = latestOnly();
let views: EditorView[] = [];

const clearViews = (): void => {
  views.forEach((view) => view.destroy());
  views = [];
};

async function load(runId: string, kept = false): Promise<void> {
  const ticket = reads.take();
  const result = await loadOriginals(runId);
  if (!reads.isLatest(ticket)) return;
  if (result.ok) originals.value = result.value;
  else if (!kept) originals.value = null;
}

const dark = computed(() => activeThemeVars.value === null || !isLightTheme(activeThemeVars.value));

// The views are built once the hosts are in the page, and again when the theme turns light or dark; the gone files
// have no host.
watch([hosts, dark], ([elements, isDark]) => {
  clearViews();
  const shown = (originals.value?.files ?? []).filter((file) => file.current !== null);
  // CodeMirror fills `$` with the count; the translation keeps it where its own language wants the number.
  const phrases = { "$ unchanged lines": t("blueprints.run.originalsFolded", { count: "$" }) };
  views = (elements ?? []).map((host, index) => createDiffView(host, shown[index]?.original ?? "", shown[index]?.current ?? "", { phrases, dark: isDark }));
});

watch(
  () => props.runId,
  (runId) => void load(runId),
  { immediate: true },
);
// The screen is kept while closed; what this shows may have changed in the meantime.
onOverlayShownAgain(() => void load(props.runId, true));
onBeforeUnmount(clearViews);
</script>

<template>
  <section v-if="originals && originals.files.length > 0" class="flex flex-col gap-2" data-testid="blueprint-originals">
    <h3 class="m-0 font-sans text-[13px] font-[650] text-fg">{{ t("blueprints.run.originals") }}</h3>
    <p class="m-0 font-sans text-[12px] text-secondary">
      {{ t("blueprints.run.originalsHint") }}
      <span v-if="originals.files.some((file) => file.from === undefined)" data-testid="blueprint-originals-kept">{{
        t("blueprints.run.originalsKept", { dir: ORIGINALS_DIR })
      }}</span>
      <span v-if="originals.files.some((file) => file.from !== undefined)" data-testid="blueprint-originals-proposed">{{
        t("blueprints.run.originalsProposed")
      }}</span>
    </p>
    <div v-for="file in originals.files" :key="file.path" class="flex flex-col gap-1" data-testid="blueprint-original">
      <span class="font-mono text-[12px] text-fg">{{ file.from === undefined ? file.path : `${file.from} → ${file.path}` }}</span>
      <p v-if="file.current === null" class="m-0 font-sans text-[12px] text-secondary" data-testid="blueprint-original-gone">
        {{ t("blueprints.run.originalsGone") }}
      </p>
      <div v-else ref="diffHost" class="max-h-[60vh] overflow-y-auto rounded-md border border-border text-[13px]" data-testid="blueprint-original-diff" />
    </div>
    <p v-if="originals.more" class="m-0 font-sans text-[12px] text-secondary">{{ t("blueprints.run.originalsMore") }}</p>
  </section>
</template>
