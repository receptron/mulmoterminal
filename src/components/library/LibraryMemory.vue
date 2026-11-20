<script setup lang="ts">
// The Library's memory kind (#3331): every project's memory, grouped by project with how full its
// MEMORY.md is, and one memory read beside the list — its frontmatter apart from its body, and its
// `[[name]]` links followed. Read only here; editing is a later step.
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { MEMORY_INDEX_LINES_MAX, type LibraryMemoryFile, type LibraryMemoryProject } from "../../../common/libraryMemory";
import { renderWikiHtml } from "../../wikiMarkdown";
import type { LibraryFileText } from "../../../common/libraryFiles";
import { loadLibraryMemoryFile } from "../../composables/libraryApi";
import { projectName, whenLabel } from "./libraryRows";
import { movedIndex } from "./libraryKeys";
import { filterMemory, indexFill, linkTarget, memoryKey, memoryTitle } from "./memoryRows";

const props = defineProps<{ projects: LibraryMemoryProject[]; loaded: boolean; failed: boolean; query: string; now: number }>();
const { t, locale } = useI18n();

const shown = computed(() => filterMemory(props.projects, props.query));
const rows = computed(() => shown.value.flatMap((project) => project.files.map((memory) => ({ project, memory, key: memoryKey(project.slug, memory.file) }))));
const chosenKey = ref<string | null>(null);
const readerShown = ref(false);
const selected = computed(() => rows.value.find((row) => row.key === chosenKey.value) ?? rows.value[0] ?? null);
const text = ref<LibraryFileText | null>(null);
let reads = 0;

watch(
  () => selected.value?.key ?? null,
  async () => {
    const row = selected.value;
    const mine = ++reads;
    text.value = null;
    if (row === null) return;
    const read = await loadLibraryMemoryFile(row.project.slug, row.memory.file);
    if (mine === reads) text.value = read ?? { text: null, reason: "unreadable" };
  },
  { immediate: true },
);

/** The body as Markdown, through the wiki's sanitizing renderer (it drops the frontmatter and turns
 *  `[[name]]` into focusable link spans); a link naming no memory here is marked as not one. */
const bodyHtml = computed((): string => {
  const row = selected.value;
  if (row === null || text.value?.text == null) return "";
  const doc = new DOMParser().parseFromString(renderWikiHtml(text.value.text), "text/html");
  // The wiki points an image at the workspace's file route; a memory has no files of its own to show,
  // so an image is its alt text and nothing is fetched.
  doc.querySelectorAll("img").forEach((image) => image.replaceWith(doc.createTextNode(image.getAttribute("alt") ?? "")));
  doc.querySelectorAll("span[data-page]").forEach((link) => {
    if (linkTarget(row.project, link.getAttribute("data-page") ?? "") !== null) return;
    link.setAttribute("aria-disabled", "true");
    link.setAttribute("data-tip", t("libraryView.memory.linkMissing"));
  });
  return doc.body.innerHTML;
});

/** Prose spacing from the replies' rules (`.md-prose`), links from the wiki's (`.wiki-body`). */
const BODY_CLASS = "md-prose wiki-body max-w-[65ch] break-words font-sans text-[14px] leading-[1.7] text-fg";

/** A `[[name]]` clicked, or pressed with Enter or Space. */
function onBodyActivate(event: Event): void {
  if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
  const link = event.target instanceof Element ? event.target.closest("span[data-page]") : null;
  if (link === null) return;
  event.preventDefault();
  follow(link.getAttribute("data-page") ?? "");
}

const projectLabel = (project: LibraryMemoryProject): string => projectName(project.cwd) ?? project.slug;
const meta = (memory: LibraryMemoryFile): string =>
  [memory.type, whenLabel(memory.updatedAt, props.now, locale.value)].filter((part): part is string => part !== null && part !== "").join(" · ");

function choose(key: string): void {
  chosenKey.value = key;
  readerShown.value = true;
}
function follow(name: string): void {
  const row = selected.value;
  const target = row ? linkTarget(row.project, name) : null;
  if (row && target) choose(memoryKey(row.project.slug, target.file));
}

/** The arrow keys, from the overlay: the next memory in the order the list shows them. */
async function move(by: number): Promise<void> {
  const index = selected.value ? rows.value.indexOf(selected.value) : -1;
  chosenKey.value = rows.value[movedIndex(index, by, rows.value.length)]?.key ?? null;
  await nextTick();
  document.querySelector("[data-memory-row][aria-current=true]")?.scrollIntoView?.({ block: "nearest" });
}
defineExpose({ move });
</script>

<template>
  <p v-if="failed" class="m-0 px-4 py-6 font-sans text-[13px] text-err-text" data-testid="memory-failed">{{ t("libraryView.memory.loadFailed") }}</p>
  <p v-else-if="!loaded" class="m-0 px-4 py-6 font-sans text-[13px] text-dim">{{ t("libraryView.loading") }}</p>
  <p v-else-if="projects.length === 0" class="m-0 px-4 py-6 font-sans text-[13px] text-dim" data-testid="memory-empty">{{ t("libraryView.memory.empty") }}</p>
  <p v-else-if="rows.length === 0" class="m-0 px-4 py-6 font-sans text-[13px] text-dim" data-testid="memory-no-match">
    {{ t("libraryView.noMatch", { query: query.trim() }) }}
  </p>
  <div v-else class="flex min-h-0 flex-1 border-t border-border" data-testid="library-memory">
    <div
      class="min-h-0 w-[360px] flex-none overflow-y-auto border-r border-border py-2 max-[760px]:w-full max-[760px]:border-r-0"
      :class="readerShown ? 'max-[760px]:hidden' : ''"
    >
      <section v-for="project in shown" :key="project.slug" class="mb-2">
        <h3 class="m-0 flex items-center gap-2 px-4 pb-1 pt-2 font-sans text-[11px] font-[650] uppercase tracking-[0.04em] text-dim">
          <span class="min-w-0 truncate" :data-tip="project.cwd ?? project.slug">{{ projectLabel(project) }}</span>
          <span
            v-if="indexFill(project.index)"
            class="ml-auto flex-none font-normal normal-case tabular-nums"
            :class="indexFill(project.index)?.warn ? 'text-warn' : ''"
            data-testid="memory-index-fill"
            :data-tip="t('libraryView.memory.indexTip')"
          >
            {{ t("libraryView.memory.indexLines", { lines: indexFill(project.index)?.lines, max: MEMORY_INDEX_LINES_MAX }) }}
          </span>
        </h3>
        <button
          v-for="memory in project.files"
          :key="memory.file"
          type="button"
          data-memory-row
          data-library-row
          data-testid="memory-row"
          class="block w-full cursor-pointer border-0 px-4 py-1.5 text-left font-sans"
          :class="selected?.key === memoryKey(project.slug, memory.file) ? 'bg-selected' : 'bg-transparent hover:bg-hover'"
          :aria-current="selected?.key === memoryKey(project.slug, memory.file)"
          @click="choose(memoryKey(project.slug, memory.file))"
        >
          <span class="block truncate text-[13px] text-fg">{{ memoryTitle(memory) }}</span>
          <span class="block truncate text-[12px] text-dim">{{ meta(memory) }}</span>
        </button>
      </section>
    </div>
    <article v-if="selected" class="flex min-h-0 min-w-0 flex-1 flex-col" :class="readerShown ? '' : 'max-[760px]:hidden'" data-testid="memory-reader">
      <button
        type="button"
        class="hidden cursor-pointer items-center gap-1 border-0 bg-transparent px-4 pt-3 font-sans text-[13px] text-secondary max-[760px]:flex"
        @click="readerShown = false"
      >
        <span class="material-symbols-outlined text-[18px]">arrow_back</span>{{ t("libraryView.back") }}
      </button>
      <header class="px-4 pb-2 pt-5">
        <h2 class="m-0 text-balance font-sans text-[20px] font-[650] text-fg">{{ memoryTitle(selected.memory) }}</h2>
        <p class="m-0 mt-1 flex flex-wrap gap-x-3 font-sans text-[12px] text-dim">
          <span class="font-mono">{{ selected.memory.file }}</span>
          <span>{{ projectLabel(selected.project) }}</span>
          <span v-if="meta(selected.memory)">{{ meta(selected.memory) }}</span>
        </p>
        <p v-if="selected.memory.description" class="m-0 mt-2 font-sans text-[13px] text-secondary">{{ selected.memory.description }}</p>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto border-t border-border px-4 py-3" @click="onBodyActivate" @keydown="onBodyActivate">
        <p v-if="text && text.text === null" class="m-0 font-sans text-[13px] text-err-text">{{ t("libraryView.memory.unreadable") }}</p>
        <!-- eslint-disable-next-line vue/no-v-html -- markdown in, sanitized in renderWikiHtml -->
        <div v-else :class="BODY_CLASS" data-testid="memory-body" v-html="bodyHtml"></div>
      </div>
    </article>
  </div>
</template>
