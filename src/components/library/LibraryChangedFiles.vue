<script setup lang="ts">
// The files a conversation changed (#3330), closing the reader as the design has it: one strip that
// opens to the files and, for the one chosen, a diff — the whole change, or one turn's. Read only.
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import type { EditorView } from "@codemirror/view";
import { useI18n } from "vue-i18n";
import type { LibraryConversation } from "../../../common/library";
import { NOW_VERSION, type LibraryFileText, type LibraryTrackedFile } from "../../../common/libraryFiles";
import { isLightTheme } from "../../../common/themeVars";
import { loadLibraryFiles, loadLibraryFileText } from "../../composables/libraryApi";
import { activeThemeVars } from "../../composables/useTheme";
import { createDiffView } from "../cmDiffView";
import { diffSteps, shownPath, type DiffStep } from "./changedFiles";
import { onOverlayShownAgain } from "../../composables/overlayVisibility";

const props = defineProps<{ conversation: LibraryConversation }>();
const { t } = useI18n();

const files = ref<LibraryTrackedFile[] | null>(null);
const open = ref(false);
const chosenPath = ref<string | null>(null);
const chosenStep = ref("whole");
const sides = ref<{ original: LibraryFileText; current: LibraryFileText } | null>(null);
const host = useTemplateRef<HTMLElement>("diffHost");
let view: EditorView | null = null;
let reads = 0;
// The diff's own: a list read again must not outdate a diff read for a file that is still chosen.
let sideReads = 0;

const chosen = computed(() => files.value?.find((file) => file.trackingPath === chosenPath.value) ?? null);
const steps = computed(() => (chosen.value ? diffSteps(chosen.value) : []));
const step = computed(() => steps.value.find((candidate) => candidate.key === chosenStep.value) ?? steps.value[0] ?? null);
const dark = computed(() => activeThemeVars.value === null || !isLightTheme(activeThemeVars.value));

watch(
  () => [props.conversation.id, props.conversation.cwd] as const,
  async ([id, cwd]) => {
    const mine = ++reads;
    files.value = null;
    chosenPath.value = null;
    const found = await loadLibraryFiles(id, cwd);
    if (mine !== reads) return;
    files.value = found ?? [];
    chosenPath.value = files.value[0]?.trackingPath ?? null;
  },
  { immediate: true },
);

// The screen is kept while closed and the conversation may have gone on changing files: read the list
// again, staying on the file shown when it is still there, and its sides if they are open.
async function reread(): Promise<void> {
  const mine = ++reads;
  const { id, cwd } = props.conversation;
  const found = await loadLibraryFiles(id, cwd);
  if (mine !== reads) return;
  if (found === null) {
    files.value ??= []; // nothing to keep: the re-read overtook the first one
    return;
  }
  files.value = found;
  // The sides follow from the watcher below: the new list is a new file object, so it fires.
  if (!found.some((file) => file.trackingPath === chosenPath.value)) chosenPath.value = found[0]?.trackingPath ?? null;
}
onOverlayShownAgain(() => void reread());

/** Which diff `sides` holds, so reading the same one again (a list re-read) keeps it until the answer. */
let sidesFor: string | null = null;
const sidesKey = (file: LibraryTrackedFile, shown: DiffStep): string => [props.conversation.id, file.trackingPath, shown.from, shown.to].join("\u0000");

/** `kept`: a re-read of the diff shown, which keeps it until both sides come back. */
async function loadSides(file: LibraryTrackedFile, shown: DiffStep, kept = false): Promise<void> {
  const mine = ++sideReads;
  if (!kept) sides.value = null;
  const { id, cwd } = props.conversation;
  const [original, current] = await Promise.all([
    loadLibraryFileText(id, cwd, file.trackingPath, shown.from),
    loadLibraryFileText(id, cwd, file.trackingPath, shown.to),
  ]);
  if (mine !== sideReads) return;
  if (kept && sides.value !== null && (original === null || current === null)) return;
  const failed: LibraryFileText = { text: null, reason: "unreadable" };
  sides.value = { original: original ?? failed, current: current ?? failed };
  sidesFor = sidesKey(file, shown);
}

watch([chosen, step, open], ([file, shown, isOpen]) => {
  if (file && shown && isOpen) void loadSides(file, shown, sidesKey(file, shown) === sidesFor);
});

/** Why the diff cannot be drawn, or null when both sides can: an absent side is drawn as empty. */
const blocked = computed((): string | null => {
  const reason = [sides.value?.original.reason, sides.value?.current.reason].find((why) => why !== undefined && why !== "absent");
  return reason === undefined ? null : t(`libraryView.files.${reason}`);
});

const clearView = (): void => {
  view?.destroy();
  view = null;
};
watch([host, sides, dark, blocked], () => {
  clearView();
  if (!host.value || !sides.value || blocked.value !== null) return;
  const phrases = { "$ unchanged lines": t("libraryView.files.folded", { count: "$" }) };
  view = createDiffView(host.value, sides.value.original.text ?? "", sides.value.current.text ?? "", { phrases, dark: dark.value });
});
onBeforeUnmount(clearView);

const stepLabel = (shown: DiffStep): string => {
  if (shown.key === "whole") return t("libraryView.files.whole");
  return shown.to === NOW_VERSION ? t("libraryView.files.stepToNow", { from: shown.from }) : t("libraryView.files.step", { from: shown.from, to: shown.to });
};
function choose(file: LibraryTrackedFile): void {
  chosenPath.value = file.trackingPath;
  chosenStep.value = "whole";
}
</script>

<template>
  <section v-if="files && files.length > 0" class="flex max-h-[50%] min-h-0 flex-col border-t border-border" data-testid="library-files">
    <button
      type="button"
      class="flex cursor-pointer items-center gap-2 border-0 bg-transparent px-4 py-2 text-left font-sans text-[12px] text-secondary hover:text-fg"
      :aria-expanded="open"
      data-testid="library-files-toggle"
      @click="open = !open"
    >
      <span class="material-symbols-outlined text-[16px]" aria-hidden="true">{{ open ? "expand_more" : "chevron_right" }}</span>
      <span class="font-[650] text-fg">{{ t("libraryView.files.title") }}</span>
      <span class="tabular-nums text-dim">{{ files.length }}</span>
    </button>
    <div v-if="open" class="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-3 sm:flex-row">
      <ul class="m-0 max-h-[6rem] w-full flex-none list-none overflow-y-auto p-0 sm:max-h-none sm:w-[14rem]" :aria-label="t('libraryView.files.title')">
        <li v-for="file in files" :key="file.trackingPath">
          <button
            type="button"
            class="w-full cursor-pointer truncate rounded border-0 px-2 py-1 text-left font-mono text-[12px]"
            :class="file.trackingPath === chosenPath ? 'bg-selected text-fg' : 'bg-transparent text-secondary hover:bg-hover'"
            :aria-current="file.trackingPath === chosenPath"
            :data-tip="file.path ?? file.trackingPath"
            data-testid="library-file"
            @click="choose(file)"
          >
            {{ shownPath(file, conversation.cwd) }}
          </button>
        </li>
      </ul>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <p class="m-0 font-sans text-[11px] text-dim">{{ t("libraryView.files.hint") }}</p>
        <div v-if="steps.length > 1" class="flex flex-wrap gap-1" role="group" :aria-label="t('libraryView.files.steps')">
          <button
            v-for="shown in steps"
            :key="shown.key"
            type="button"
            class="cursor-pointer rounded-[10px] border px-2 py-px font-sans text-[11px]"
            :class="shown.key === step?.key ? 'border-accent text-fg' : 'border-border text-secondary hover:text-fg'"
            :aria-pressed="shown.key === step?.key"
            data-testid="library-file-step"
            @click="chosenStep = shown.key"
          >
            {{ stepLabel(shown) }}
          </button>
        </div>
        <p v-if="blocked" class="m-0 font-sans text-[12px] text-secondary" data-testid="library-file-blocked">{{ blocked }}</p>
        <div v-else ref="diffHost" class="min-h-[6rem] flex-1 overflow-auto rounded border border-border" data-testid="library-file-diff" />
      </div>
    </div>
  </section>
</template>
