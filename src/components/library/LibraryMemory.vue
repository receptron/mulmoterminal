<script setup lang="ts">
// The Library's memory kind (#3331): every project's memory, grouped by project with how full its
// MEMORY.md is, and one memory read beside the list — its frontmatter apart from its body, and its
// `[[name]]` links followed. Edited in place, moved to the Trash or merged into another, with Undo.
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  MEMORY_INDEX_BYTES_MAX,
  MEMORY_INDEX_LINES_MAX,
  parseMemoryFrontmatter,
  type LibraryMemoryFile,
  type LibraryMemoryProject,
  type LibraryMemoryHealth,
  type MemoryFileIssue,
  type MemoryProjectIssue,
} from "../../../common/libraryMemory";
import { renderWikiHtml } from "../../wikiMarkdown";
import LibraryMemoryEditor from "./LibraryMemoryEditor.vue";
import LibraryMoreMenu from "./LibraryMoreMenu.vue";
import LibraryMemoryMergeChooser from "./LibraryMemoryMergeChooser.vue";
import { useMemoryTrash } from "../../composables/useMemoryTrash";
import { hasMemoryDraft, memoryDraftKey } from "./memoryDrafts";
import type { LibraryFileText } from "../../../common/libraryFiles";
import { loadLibraryMemoryFile } from "../../composables/libraryApi";
import { projectName, whenLabel } from "./libraryRows";
import { movedIndex } from "./libraryKeys";
import { fileIssues, filterMemory, filterTidy, indexFill, linkTarget, memoryKey, memoryTitle, tidyCount } from "./memoryRows";

const props = defineProps<{
  projects: LibraryMemoryProject[];
  loaded: boolean;
  failed: boolean;
  query: string;
  now: number;
  /** What can be tidied, by project slug; empty until judged. */
  health: ReadonlyMap<string, LibraryMemoryHealth>;
  /** The check itself failed: say so, rather than look as if all were tidy. */
  healthFailed?: boolean;
}>();
const emit = defineEmits<{ (e: "changed"): void }>();
const { t, locale } = useI18n();

/** Only what can be tidied, when "Show" was pressed on the line above the list. */
const tidyOnly = ref(false);
const tidy = computed(() => tidyCount(props.projects, props.health));
const shown = computed(() => {
  const matching = filterMemory(props.projects, props.query);
  return tidyOnly.value ? filterTidy(matching, props.health) : matching;
});

// A list read again (the Library opened again) starts unnarrowed: what was being looked at may be gone.
watch(
  () => props.projects,
  () => (tidyOnly.value = false),
);

// Narrowing can hide the memory being read: move to the first one still shown, so the reader and the
// highlighted row agree, and widening again does not jump back to a hidden choice.
watch(tidyOnly, () => {
  if (selected.value !== null && chosenKey.value !== selected.value.key) chosenKey.value = selected.value.key;
});

/** Another work copy as the reader names it: its directory's name, and whether its memory is the same. */
function copyLabel(copy: { slug: string; same: boolean }): string {
  const project = props.projects.find((candidate) => candidate.slug === copy.slug);
  const name = (project ? projectName(project.cwd) : null) ?? copy.slug;
  return t(copy.same ? "libraryView.memory.copySame" : "libraryView.memory.copyDiffers", { name });
}

/** One sentence per issue, in the reader's language. */
function issueSentence(issue: MemoryFileIssue | MemoryProjectIssue): string {
  const list = (items: string[]): string => items.join(", ");
  const key = `libraryView.memory.issues.${issue.kind}`;
  if (issue.kind === "no-frontmatter") return t(key, { fields: list(issue.missing) });
  if (issue.kind === "broken-link") return t(key, { names: list(issue.names.map((name) => `[[${name}]]`)) });
  if (issue.kind === "missing-path") return t(key, { paths: list(issue.paths) });
  if (issue.kind === "dead-index-entry") return t(key, { files: list(issue.files) });
  if (issue.kind === "in-work-copies") return t(key, { copies: list(issue.copies.map(copyLabel)) });
  return t(key);
}
const rows = computed(() => shown.value.flatMap((project) => project.files.map((memory) => ({ project, memory, key: memoryKey(project.slug, memory.file) }))));
const chosenKey = ref<string | null>(null);
const readerShown = ref(false);
const selected = computed(() => rows.value.find((row) => row.key === chosenKey.value) ?? rows.value[0] ?? null);
const text = ref<(LibraryFileText & { version?: string }) | null>(null);
/** Bumped to read the memory again (after a conflict). */
const rereads = ref(0);
let reads = 0;

// Read again when another memory is chosen, when it changed on disk, and when the list is read again
// (each time the Library opens), so a memory written while it was closed never shows its old text.
watch(
  () => [selected.value?.key ?? null, selected.value?.memory.updatedAt ?? null, props.projects, rereads.value] as const,
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
  // The body as this file's own parser cut it, so the renderer never decides frontmatter differently.
  const doc = new DOMParser().parseFromString(renderWikiHtml(parseMemoryFrontmatter(text.value.text).body), "text/html");
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

/** The index against the limit nearer to full: lines, or kilobytes when the bytes are nearer. */
function gaugeLabel(project: LibraryMemoryProject): string {
  const fill = indexFill(project.index);
  if (fill === null) return "";
  if (fill.by === "lines") return t("libraryView.memory.indexLines", { lines: fill.lines, max: MEMORY_INDEX_LINES_MAX });
  const kilobytes = (bytes: number): string => (bytes / 1000).toFixed(1);
  return t("libraryView.memory.indexBytes", { size: kilobytes(fill.bytes), max: kilobytes(MEMORY_INDEX_BYTES_MAX) });
}

const projectLabel = (project: LibraryMemoryProject): string => projectName(project.cwd) ?? project.slug;
const meta = (memory: LibraryMemoryFile): string =>
  [memory.type, whenLabel(memory.updatedAt, props.now, locale.value)].filter((part): part is string => part !== null && part !== "").join(" · ");

const editor = useTemplateRef<{ dirty: boolean }>("editor");
/** Bumped when leaving was refused, for the editor to say why. */
const leaveRefused = ref(0);

/** Whether an unsaved edit holds the selection: leaving it would lose the draft without a word. */
function holdsDraft(): boolean {
  if (!editing.value || editor.value?.dirty !== true) return false;
  leaveRefused.value += 1;
  return true;
}

function choose(key: string): void {
  if (key !== selected.value?.key && holdsDraft()) return;
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
  if (holdsDraft()) return;
  const index = selected.value ? rows.value.indexOf(selected.value) : -1;
  chosenKey.value = rows.value[movedIndex(index, by, rows.value.length)]?.key ?? null;
  await nextTick();
  document.querySelector("[data-memory-row][aria-current=true]")?.scrollIntoView?.({ block: "nearest" });
}
/** Editing the memory being read, in place of its body. */
const editing = ref(false);
/** Choosing the memory to merge the one being read into, in place of its body. */
const choosingMerge = ref(false);
watch(
  () => selected.value?.key ?? null,
  () => {
    editing.value = false;
    choosingMerge.value = false;
  },
);

/** Enter, from the overlay: the primary action, editing. */
function startEdit(): void {
  if (selected.value !== null && typeof text.value?.version === "string") editing.value = true;
}

function onSaved(saved: string, version: string): void {
  text.value = { text: saved, version };
  stopEditing();
  emit("changed");
}

function onReload(): void {
  stopEditing();
  rereads.value += 1;
}

function stopEditing(): void {
  editing.value = false;
  merging.value = null;
}

/** A memory being merged into the one now read: chosen in the reader, then edited into it there. */
const merging = ref<{ into: string; key: string; file: string; version: string; title: string; body: string } | null>(null);
const mergeChoices = computed(() => {
  const row = selected.value;
  if (row === null) return [];
  return row.project.files
    .filter((memory) => memory.file !== row.memory.file)
    .map((memory) => ({ key: memoryKey(row.project.slug, memory.file), title: memoryTitle(memory), file: memory.file }));
});

function chooseMerge(): void {
  moreMenu.value?.close();
  choosingMerge.value = true;
}

/** Reads the memory chosen to merge into, and edits it with the one that was read added at its end. */
function pickMerge(into: string): void {
  const row = selected.value;
  const version = text.value?.version;
  if (row === null || text.value?.text == null || typeof version !== "string") return;
  const body = parseMemoryFrontmatter(text.value.text).body;
  merging.value = { into, key: row.key, file: row.memory.file, version, title: memoryTitle(row.memory), body };
  chosenKey.value = into;
}

// The editor opens once the memory merged into has been read; choosing another one gives the merge up.
watch(text, (read) => {
  const pending = merging.value;
  if (pending === null) return;
  if (selected.value?.key !== pending.into) merging.value = null;
  else if (typeof read?.version === "string") editing.value = true;
});

function onMerged(saved: string, version: string, undoId: string, links: number): void {
  const done = merging.value;
  text.value = { text: saved, version };
  stopEditing();
  if (done !== null && selected.value !== null) mergedNotice(done, memoryTitle(selected.value.memory), undoId, links);
}

const moreMenu = useTemplateRef<{ close: () => void }>("moreMenu");
const { available: trashOffered, notice: trashNotice, trash, merged: mergedNotice, undo, dismiss: dismissTrashNotice } = useMemoryTrash(() => emit("changed"));

/** The memory being read, to the Trash; the reader moves on to the next one in the list. */
async function trashSelected(): Promise<void> {
  moreMenu.value?.close();
  const row = selected.value;
  const version = text.value?.version;
  if (row === null || typeof version !== "string") return;
  const at = rows.value.indexOf(row);
  const next = rows.value[at + 1]?.key ?? rows.value[at - 1]?.key ?? null;
  const target = { slug: row.project.slug, file: row.memory.file, version, title: memoryTitle(row.memory), key: row.key, cwd: row.project.cwd };
  const outcome = await trash(target);
  if (outcome === "trashed" && selected.value?.key === row.key) chosenKey.value = next;
  else if (outcome === "changed") rereads.value += 1;
}

async function undoTrash(): Promise<void> {
  const restored = await undo();
  if (restored !== null) chosenKey.value = restored;
}

function trashNoticeText(): string {
  const shown = trashNotice.value;
  if (shown === null) return "";
  if (shown.kind !== "trashed") return t(`libraryView.memory.trash.${shown.kind}`);
  if (shown.undoFailed === true) return t("libraryView.memory.trash.undo-failed");
  if (shown.into !== undefined) {
    const merged = t("libraryView.memory.trash.merged", { title: shown.title, into: shown.into });
    return shown.links ? `${merged} ${t("libraryView.memory.trash.mergedLinks", { count: shown.links })}` : merged;
  }
  const done = t("libraryView.memory.trash.trashed", { title: shown.title });
  return shown.running ? `${done} ${t("libraryView.memory.trash.running")}` : done;
}

defineExpose({ move, startEdit });
</script>

<template>
  <p v-if="failed" class="m-0 px-4 py-6 font-sans text-[13px] text-err-text" data-testid="memory-failed">{{ t("libraryView.memory.loadFailed") }}</p>
  <p v-else-if="!loaded" class="m-0 px-4 py-6 font-sans text-[13px] text-dim">{{ t("libraryView.loading") }}</p>
  <p v-else-if="projects.length === 0" class="m-0 px-4 py-6 font-sans text-[13px] text-dim" data-testid="memory-empty">{{ t("libraryView.memory.empty") }}</p>
  <p v-else-if="shown.length === 0" class="m-0 px-4 py-6 font-sans text-[13px] text-dim" data-testid="memory-no-match">
    {{ t("libraryView.noMatch", { query: query.trim() }) }}
  </p>
  <div v-else class="flex min-h-0 flex-1 border-t border-border" data-testid="library-memory">
    <div
      class="min-h-0 w-[360px] flex-none overflow-y-auto border-r border-border py-2 max-[760px]:w-full max-[760px]:border-r-0"
      :class="readerShown ? 'max-[760px]:hidden' : ''"
    >
      <p v-if="healthFailed" class="m-0 px-4 pb-1 font-sans text-[12px] text-err-text" data-testid="memory-health-failed">
        {{ t("libraryView.memory.healthFailed") }}
      </p>
      <p v-if="tidy > 0" class="m-0 flex items-center gap-2 px-4 pb-1 font-sans text-[12px] text-secondary" data-testid="memory-tidy">
        <span class="h-[6px] w-[6px] flex-none rounded-full bg-warn" aria-hidden="true"></span>
        {{ t("libraryView.memory.tidy", { count: tidy }) }}
        <button
          type="button"
          class="cursor-pointer border-0 bg-transparent p-0 font-sans text-[12px] text-accent hover:underline"
          :aria-pressed="tidyOnly"
          data-testid="memory-tidy-toggle"
          @click="tidyOnly = !tidyOnly"
        >
          {{ tidyOnly ? t("libraryView.memory.tidyAll") : t("libraryView.memory.tidyShow") }}
        </button>
      </p>
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
            {{ gaugeLabel(project) }}
          </span>
        </h3>
        <p
          v-for="issue in health.get(project.slug)?.issues ?? []"
          :key="issue.kind"
          class="m-0 px-4 pb-1 font-sans text-[12px] text-warn"
          data-testid="memory-project-issue"
        >
          {{ issueSentence(issue) }}
        </p>
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
          <span class="flex items-center gap-1.5 truncate text-[13px] text-fg">
            <span
              v-if="fileIssues(health, project.slug, memory.file).length > 0"
              class="h-[6px] w-[6px] flex-none rounded-full bg-warn"
              data-testid="memory-row-dot"
              :aria-label="t('libraryView.memory.tidy', { count: 1 })"
              role="img"
            ></span>
            <span class="truncate">{{ memoryTitle(memory) }}</span>
          </span>
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
        <p
          v-for="issue in fileIssues(health, selected.project.slug, selected.memory.file)"
          :key="issue.kind"
          class="m-0 mt-2 font-sans text-[13px] text-warn"
          data-testid="memory-issue"
        >
          {{ issueSentence(issue) }}
        </p>
        <p v-if="selected.memory.description" class="m-0 mt-2 font-sans text-[13px] text-secondary">{{ selected.memory.description }}</p>
      </header>
      <LibraryMemoryEditor
        v-if="editing && text?.text != null && text.version"
        ref="editor"
        :key="merging ? `${selected.key}:merge` : selected.key"
        :leave-refused="leaveRefused"
        :merging="merging && merging.into === selected.key ? merging : null"
        :slug="selected.project.slug"
        :file="selected.memory.file"
        :text="text.text"
        :version="text.version"
        :cwd="selected.project.cwd"
        @saved="onSaved"
        @merged="onMerged"
        @cancel="stopEditing"
        @reload="onReload"
      />
      <LibraryMemoryMergeChooser
        v-else-if="choosingMerge"
        :title="memoryTitle(selected.memory)"
        :choices="mergeChoices"
        @pick="pickMerge"
        @cancel="choosingMerge = false"
      />
      <template v-else>
        <div class="min-h-0 flex-1 overflow-y-auto border-t border-border px-4 py-3" @click="onBodyActivate" @keydown="onBodyActivate">
          <p v-if="text && text.text === null" class="m-0 font-sans text-[13px] text-err-text">{{ t("libraryView.memory.unreadable") }}</p>
          <!-- eslint-disable-next-line vue/no-v-html -- markdown in, sanitized in renderWikiHtml -->
          <div v-else :class="BODY_CLASS" data-testid="memory-body" v-html="bodyHtml"></div>
        </div>
        <footer v-if="text?.version" class="flex items-center justify-end gap-3 border-t border-border px-4 py-2">
          <LibraryMoreMenu v-if="trashOffered" ref="moreMenu" :key="selected.key">
            <button
              type="button"
              role="menuitem"
              data-testid="memory-trash"
              class="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left font-sans text-[13px] text-fg hover:bg-hover"
              @click="trashSelected"
            >
              <span class="material-symbols-outlined text-[18px]">delete</span>{{ t("libraryView.memory.trash.action") }}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="memory-merge"
              class="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left font-sans text-[13px] text-fg hover:bg-hover"
              @click="chooseMerge"
            >
              <span class="material-symbols-outlined text-[18px]">merge</span>{{ t("libraryView.memory.merge.action") }}
            </button>
          </LibraryMoreMenu>
          <span
            v-if="hasMemoryDraft(memoryDraftKey(selected.project.slug, selected.memory.file))"
            class="min-w-0 flex-1 font-sans text-[12px] text-secondary"
            data-testid="memory-draft-kept"
          >
            {{ t("libraryView.memory.edit.draftKept") }}
          </span>
          <button
            type="button"
            data-testid="memory-edit"
            class="flex flex-none cursor-pointer items-center gap-2 rounded-[6px] border-0 bg-accent px-4 py-2 font-sans text-[13px] font-semibold text-on-accent"
            @click="startEdit"
          >
            <span class="material-symbols-outlined text-[18px]">edit</span>
            {{ t("libraryView.memory.edit.edit") }}
            <kbd class="rounded border border-on-accent/40 px-1 font-sans text-[11px] font-normal">Enter</kbd>
          </button>
        </footer>
      </template>
    </article>
  </div>
  <!-- Outside the list, so it stays when the last memory went and the list became the empty sentence. -->
  <p
    v-if="trashNotice"
    class="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2 font-sans text-[12px] text-secondary"
    role="status"
    data-testid="memory-trash-notice"
  >
    <span class="min-w-0">{{ trashNoticeText() }}</span>
    <button
      v-if="trashNotice.kind === 'trashed'"
      type="button"
      class="cursor-pointer border-0 bg-transparent p-0 font-sans text-[12px] font-semibold text-accent hover:underline"
      data-testid="memory-trash-undo"
      @click="undoTrash"
    >
      {{ t("libraryView.memory.trash.undo") }}
    </button>
    <button
      type="button"
      class="ml-auto flex cursor-pointer items-center border-0 bg-transparent p-0 text-dim hover:text-fg"
      :aria-label="t('libraryView.memory.trash.dismiss')"
      @click="dismissTrashNotice"
    >
      <span class="material-symbols-outlined text-[16px]">close</span>
    </button>
  </p>
</template>
