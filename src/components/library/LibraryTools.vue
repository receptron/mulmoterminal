<script setup lang="ts">
// The Library's tools kind (#3332): one directory chosen, and the instruction files Claude Code loads
// there in the order it loads them, each read beside the list. Read only.
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { LibraryInstructionFile, LibraryInstructions } from "../../../common/libraryTools";
import type { LibraryFileText } from "../../../common/libraryFiles";
import { loadInstruction, loadInstructions, loadToolDirectories } from "../../composables/libraryApi";
import { movedIndex } from "./libraryKeys";
import { instructionLabel } from "./toolRows";

const props = defineProps<{ query: string; initialCwd: string | null }>();
const { t } = useI18n();

const directories = ref<string[] | null>(null);
const cwd = ref<string | null>(null);
const instructions = ref<LibraryInstructions | null>(null);
const failed = ref(false);
const chosen = ref<string | null>(null);
const text = ref<LibraryFileText | null>(null);

/** The directories could not be listed (the index is unavailable): said, not shown as "none yet". */
const directoriesFailed = ref(false);

void (async () => {
  const listed = await loadToolDirectories();
  directoriesFailed.value = listed === null;
  directories.value = listed ?? [];
  const wanted = props.initialCwd;
  cwd.value = wanted !== null && directories.value.includes(wanted) ? wanted : (directories.value[0] ?? null);
})();

let reads = 0;
watch(cwd, async (dir) => {
  const mine = ++reads;
  instructions.value = null;
  failed.value = false;
  chosen.value = null;
  if (dir === null) return;
  const read = await loadInstructions(dir);
  if (mine !== reads) return;
  instructions.value = read;
  failed.value = read === null;
});

const shown = computed(() => {
  const needle = props.query.trim().toLowerCase();
  const files = instructions.value?.files ?? [];
  return needle === "" ? files : files.filter((file) => file.path.toLowerCase().includes(needle));
});
const selected = computed(() => shown.value.find((file) => file.path === chosen.value) ?? shown.value[0] ?? null);

let textReads = 0;
watch(
  () => [cwd.value, selected.value?.path ?? null] as const,
  async ([dir, file]) => {
    const mine = ++textReads;
    text.value = null;
    if (dir === null || file === null) return;
    const read = await loadInstruction(dir, file);
    if (mine === textReads) text.value = read ?? { text: null, reason: "unreadable" };
  },
);

const label = (file: LibraryInstructionFile) => instructionLabel(file, cwd.value ?? "");
const notes = (file: LibraryInstructionFile): string[] =>
  [
    file.loads === "on-demand" ? t("libraryView.tools.onDemand") : null,
    file.state === "too-large" ? t("libraryView.tools.tooLarge") : null,
    file.state === "unreadable" ? t("libraryView.tools.unreadable") : null,
    file.importedBy !== null ? t("libraryView.tools.importedBy", { name: instructionLabel({ path: file.importedBy }, cwd.value ?? "") }) : null,
  ].filter((note): note is string => note !== null);

/** The arrow keys, from the overlay. */
async function move(by: number): Promise<void> {
  const index = selected.value ? shown.value.indexOf(selected.value) : -1;
  chosen.value = shown.value[movedIndex(index, by, shown.value.length)]?.path ?? null;
  await nextTick();
  document.querySelector("[data-tool-row][aria-current=true]")?.scrollIntoView?.({ block: "nearest" });
}
defineExpose({ move });
</script>

<template>
  <div class="flex items-center gap-2 border-t border-border px-4 py-2 font-sans text-[13px]">
    <label class="text-secondary" for="library-tools-cwd">{{ t("libraryView.tools.directory") }}</label>
    <select
      id="library-tools-cwd"
      v-model="cwd"
      class="min-w-0 max-w-full flex-1 truncate rounded border border-border bg-transparent px-2 py-1 font-mono text-[12px] text-fg"
      data-testid="library-tools-cwd"
    >
      <option v-for="dir in directories ?? []" :key="dir" :value="dir">{{ dir }}</option>
    </select>
  </div>
  <p v-if="directoriesFailed" class="m-0 px-4 py-6 font-sans text-[13px] text-err-text" data-testid="library-tools-directories-failed">
    {{ t("libraryView.tools.failed") }}
  </p>
  <p v-else-if="directories !== null && directories.length === 0" class="m-0 px-4 py-6 font-sans text-[13px] text-dim" data-testid="library-tools-empty">
    {{ t("libraryView.tools.noDirectories") }}
  </p>
  <p v-else-if="failed" class="m-0 px-4 py-6 font-sans text-[13px] text-err-text">{{ t("libraryView.tools.failed") }}</p>
  <p v-else-if="instructions === null" class="m-0 px-4 py-6 font-sans text-[13px] text-dim">{{ t("libraryView.loading") }}</p>
  <div v-else class="flex min-h-0 flex-1 border-t border-border" data-testid="library-tools">
    <div class="min-h-0 w-[360px] flex-none overflow-y-auto border-r border-border py-2 max-[760px]:w-full max-[760px]:border-r-0">
      <p v-if="instructions.agentsMd" class="m-0 px-4 pb-1 font-sans text-[12px] text-secondary" data-testid="library-tools-agents">
        {{ t("libraryView.tools.agentsMd") }}
      </p>
      <p v-if="instructions.truncated" class="m-0 px-4 pb-1 font-sans text-[12px] text-secondary" data-testid="library-tools-truncated">
        {{ t("libraryView.tools.truncated") }}
      </p>
      <p v-if="shown.length === 0" class="m-0 px-4 py-2 font-sans text-[13px] text-dim">{{ t("libraryView.tools.none") }}</p>
      <button
        v-for="file in shown"
        :key="file.path"
        type="button"
        data-tool-row
        data-library-row
        data-testid="tool-row"
        class="block w-full cursor-pointer border-0 px-4 py-1.5 text-left font-sans"
        :class="[selected?.path === file.path ? 'bg-selected' : 'bg-transparent hover:bg-hover', file.importedBy !== null ? 'pl-8' : '']"
        :aria-current="selected?.path === file.path"
        @click="chosen = file.path"
      >
        <span class="block truncate font-mono text-[12px] text-fg">{{ label(file) }}</span>
        <span class="block truncate text-[12px] text-dim">
          {{ [t(`libraryView.tools.scope.${file.scope}`), t("libraryView.tools.lines", { lines: file.lines }), ...notes(file)].join(" · ") }}
        </span>
      </button>
    </div>
    <article v-if="selected" class="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="tool-reader">
      <header class="px-4 pb-2 pt-5">
        <h2 class="m-0 break-all font-mono text-[15px] font-[650] text-fg">{{ selected.path }}</h2>
        <p class="m-0 mt-1 font-sans text-[12px] text-dim">{{ [t(`libraryView.tools.scope.${selected.scope}`), ...notes(selected)].join(" · ") }}</p>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto border-t border-border px-4 py-3">
        <p v-if="text && text.text === null" class="m-0 font-sans text-[13px] text-err-text" data-testid="tool-text-missing">
          {{ text.reason === "too-large" ? t("libraryView.tools.tooLargeToShow") : t("libraryView.tools.unreadable") }}
        </p>
        <pre v-else-if="text" class="m-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] text-fg" data-testid="tool-text">{{
          text.text
        }}</pre>
      </div>
    </article>
  </div>
</template>
