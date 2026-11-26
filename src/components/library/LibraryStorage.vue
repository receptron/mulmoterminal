<script setup lang="ts">
// The Library's Storage view (#3333): what each entry of Claude Code's home takes, largest first, and
// for `projects/` what each project takes. Read-only; the server measures on a worker and this shows
// the last measurement while a newer one runs.
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { PROJECTS_ENTRY, type LibraryStorageAnswer, type StorageEntry } from "../../../common/libraryStorage";
import { formatSize } from "../folderView";
import { whenLabel } from "./libraryRows";
import { movedIndex } from "./libraryKeys";
import LibraryBackButton from "./LibraryBackButton.vue";

const props = defineProps<{
  answer: LibraryStorageAnswer | null;
  loaded: boolean;
  failed: boolean;
  startRefused: boolean;
  now: number;
}>();
const emit = defineEmits<{ remeasure: [] }>();
const { t, locale } = useI18n();

const chosenName = ref<string | null>(null);
const readerShown = ref(false);
const entries = computed((): StorageEntry[] => props.answer?.measure?.entries ?? []);
const selected = computed((): StorageEntry | null => entries.value.find((entry) => entry.name === chosenName.value) ?? entries.value[0] ?? null);
const projects = computed(() => props.answer?.measure?.projects ?? []);
const otherProjects = computed(() => props.answer?.measure?.otherProjects ?? null);

const entryLabel = (entry: StorageEntry): string => (entry.directory ? `${entry.name}/` : entry.name);
const countLabel = (files: number): string => t("libraryView.storage.files", { count: files.toLocaleString(locale.value) }, files);

const progressLabel = computed((): string | null => {
  const running = props.answer?.measuring;
  if (!running) return null;
  return running.of > 0 ? t("libraryView.storage.measuringOf", { done: running.done, of: running.of }) : t("libraryView.storage.measuring");
});

const cleanupSentence = computed((): string => {
  const cleanup = props.answer?.cleanup;
  if (cleanup === undefined) return "";
  if (cleanup.state === "unreadable") return t("libraryView.storage.cleanupUnreadable");
  return t(cleanup.state === "set" ? "libraryView.storage.cleanupSet" : "libraryView.storage.cleanupDefault", { days: cleanup.days });
});

/** What stands in for the list when there is no measurement to show, or it found nothing. */
const noMeasureSentence = computed((): string => {
  const answer = props.answer;
  if (answer === null) return "";
  if (progressLabel.value !== null) return progressLabel.value;
  if (answer.measureFailed) return t("libraryView.storage.measureFailed");
  if (answer.measure === null) return t("libraryView.storage.notMeasured");
  const key = answer.measure.total.unreadable > 0 ? "libraryView.storage.unreadableHome" : "libraryView.storage.empty";
  return t(key, { root: answer.root });
});

/** When the shown measurement was taken, and that it is an older one when the last one failed. */
function measuredSentence(measuredAt: number): string {
  const when = t("libraryView.storage.measuredAt", { when: whenLabel(measuredAt, props.now, locale.value) });
  return props.answer?.measureFailed ? `${when} ${t("libraryView.storage.olderShown")}` : when;
}

function choose(name: string): void {
  chosenName.value = name;
  readerShown.value = true;
}

/** Move the selection by `by` rows, for the arrow keys; held inside the list, as the other kinds are. */
async function move(by: number): Promise<void> {
  const list = entries.value;
  const at = selected.value === null ? -1 : list.indexOf(selected.value);
  const next = list[movedIndex(at, by, list.length)];
  if (next === undefined) return;
  chosenName.value = next.name;
  await nextTick();
  document.querySelector("[data-storage-row][aria-current=true]")?.scrollIntoView?.({ block: "nearest" });
}

defineExpose({ move });
</script>

<template>
  <p v-if="failed && answer === null" class="m-0 px-4 py-6 font-sans text-[13px] text-err-text" data-testid="storage-failed">
    {{ t("libraryView.storage.loadFailed") }}
  </p>
  <p v-else-if="!loaded || answer === null" class="m-0 px-4 py-6 font-sans text-[13px] text-dim" role="status" data-testid="storage-waiting">
    {{ t("libraryView.storage.measuring") }}
  </p>
  <!-- No measurement to show: one running, one that failed, or none asked for yet. -->
  <div v-else-if="answer.measure === null || entries.length === 0" class="px-4 py-6 font-sans text-[13px] text-dim" data-testid="storage-unmeasured">
    <p class="m-0" role="status" :class="answer.measureFailed && !answer.measuring ? 'text-err-text' : ''">{{ noMeasureSentence }}</p>
    <button
      v-if="!answer.measuring"
      type="button"
      class="mt-2 cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] text-accent hover:underline"
      data-testid="storage-remeasure"
      @click="emit('remeasure')"
    >
      {{ t("libraryView.storage.remeasure") }}
    </button>
    <p v-if="startRefused" class="m-0 mt-2 text-err-text" role="status" data-testid="storage-start-refused">{{ t("libraryView.storage.startRefused") }}</p>
  </div>
  <div v-else class="flex min-h-0 flex-1 border-t border-border" data-testid="library-storage">
    <div
      class="min-h-0 w-[360px] flex-none overflow-y-auto border-r border-border py-2 max-[760px]:w-full max-[760px]:border-r-0"
      :class="readerShown ? 'max-[760px]:hidden' : ''"
    >
      <p class="m-0 flex items-baseline gap-2 px-4 pb-1 pt-1 font-sans text-[12px] text-dim">
        <span class="min-w-0 truncate" :data-tip="answer.root">{{ answer.root }}</span>
        <span class="ml-auto flex-none tabular-nums" data-testid="storage-total">{{
          t("libraryView.storage.total", { size: formatSize(answer.measure.total.bytes) })
        }}</span>
      </p>
      <button
        v-for="entry in entries"
        :key="entry.name"
        type="button"
        data-library-row
        data-storage-row
        data-testid="storage-row"
        class="block w-full cursor-pointer border-0 px-4 py-1.5 text-left font-sans"
        :class="selected?.name === entry.name ? 'bg-selected' : 'bg-transparent hover:bg-hover'"
        :aria-current="selected?.name === entry.name"
        @click="choose(entry.name)"
      >
        <span class="block truncate text-[13px] text-fg">{{ entryLabel(entry) }}</span>
        <span class="block text-[12px] tabular-nums text-dim">{{ formatSize(entry.bytes) }}</span>
      </button>
    </div>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" :class="readerShown ? '' : 'max-[760px]:hidden'">
      <LibraryBackButton @click="readerShown = false" />
      <article v-if="selected" class="mx-auto w-full max-w-[760px] px-6 py-5 font-sans" data-testid="storage-reader">
        <h2 class="m-0 text-[20px] font-[650] text-fg">{{ entryLabel(selected) }}</h2>
        <p class="m-0 mt-1 text-[13px] tabular-nums text-dim">
          {{ formatSize(selected.bytes) }} · {{ countLabel(selected.files) }}
          <span v-if="selected.unreadable > 0"> · {{ t("libraryView.storage.unreadable", { count: selected.unreadable }) }}</span>
        </p>

        <section v-if="selected.name === PROJECTS_ENTRY" class="mt-5" data-testid="storage-projects">
          <div
            v-for="project in projects"
            :key="project.slug"
            class="flex items-baseline gap-3 border-b border-border py-1.5 text-[13px]"
            data-testid="storage-project"
          >
            <span class="min-w-0 flex-1 truncate text-fg" :data-tip="project.cwd ?? project.slug">{{ project.cwd ?? project.slug }}</span>
            <span v-if="project.temporary" class="flex-none text-[12px] text-dim" data-testid="storage-project-temporary">{{
              t("libraryView.storage.temporary")
            }}</span>
            <span class="flex-none tabular-nums text-secondary">{{ formatSize(project.bytes) }}</span>
          </div>
          <p v-if="otherProjects && otherProjects.count > 0" class="m-0 py-1.5 text-[13px] text-dim" data-testid="storage-other-projects">
            {{ t("libraryView.storage.otherProjects", { count: otherProjects.count, size: formatSize(otherProjects.bytes) }) }}
          </p>
          <p v-if="projects.length === 0" class="m-0 py-1.5 text-[13px] text-dim">{{ t("libraryView.storage.noProject") }}</p>
        </section>

        <section class="mt-6">
          <h3 class="m-0 text-[13px] font-[650] text-dim">cleanupPeriodDays</h3>
          <p class="m-0 mt-1 text-[14px] leading-[1.6] text-fg" data-testid="storage-cleanup">{{ cleanupSentence }}</p>
        </section>

        <p class="m-0 mt-6 flex items-center gap-3 text-[12px] text-dim">
          <span role="status">{{ progressLabel ?? measuredSentence(answer.measure.measuredAt) }}</span>
          <button
            v-if="!answer.measuring"
            type="button"
            class="cursor-pointer border-0 bg-transparent p-0 font-sans text-[12px] text-accent hover:underline"
            data-testid="storage-remeasure"
            @click="emit('remeasure')"
          >
            {{ t("libraryView.storage.remeasure") }}
          </button>
          <span v-if="startRefused" class="text-err-text" role="status" data-testid="storage-start-refused">{{ t("libraryView.storage.startRefused") }}</span>
        </p>
      </article>
    </div>
  </div>
</template>
