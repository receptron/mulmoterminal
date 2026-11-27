<script setup lang="ts">
// Editing one memory in place (#3331): its whole text, frontmatter and all, so nothing the file holds is
// lost on the way back. Saved only over the text it was opened on — the agent writes memory as it
// works, and a save over its change would lose it without a word.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { dropMemoryDraft, keepMemoryDraft, memoryDraftFor, memoryDraftKey, staleMemoryDraftFor } from "./memoryDrafts";
import { isImeConfirming } from "../../composables/imeComposition";
import { useI18n } from "vue-i18n";
import { loadLibraryMemoryLinks, mergeLibraryMemoryFiles, saveLibraryMemoryFile, type MemorySaveResult } from "../../composables/libraryApi";
import { sessionRunningIn } from "./memorySessions";
import { MEMORY_EDIT_MAX_BYTES } from "../../../common/libraryMemory";
import { onOverlayShownAgain } from "../../composables/overlayVisibility";

const props = defineProps<{
  slug: string;
  file: string;
  text: string;
  version: string;
  cwd: string | null;
  /** Bumped when moving to another memory was refused because of this draft. */
  leaveRefused?: number;
  /** Another memory of this project being merged into this one: its body is added to the draft, and
   *  saving also moves it to the Trash. A merge keeps no draft — it is one step, begun again or not. */
  merging?: { file: string; version: string; title: string; body: string } | null;
  /** Another work copy's text added to the draft, to take it in here; saving is an ordinary save. Like a
   *  merge it keeps no draft. */
  adding?: { title: string; body: string } | null;
}>();
const emit = defineEmits<{
  (e: "saved", text: string, version: string): void;
  (e: "merged", text: string, version: string, undo: string, links: number): void;
  (e: "cancel" | "reload"): void;
}>();
const { t } = useI18n();

/** A textarea gives every line break as `\n`: a file written with `\r\n` is saved with them again,
 *  so opening and saving it unchanged changes nothing. */
const crlf = props.text.includes("\r\n");
const draftKey = memoryDraftKey(props.slug, props.file);
/** The draft was seeded with another memory's text: a step begun again, or not, rather than kept. */
const seeded = props.merging ?? props.adding ?? null;
const kept = seeded ? null : memoryDraftFor(draftKey, props.version);
/** A draft begun on a version the file has since left: offered, not applied. */
const stale = ref(seeded ? null : staleMemoryDraftFor(draftKey, props.version));
/** Whether the draft kept for this memory is the one in this editor: only then is it ours to drop. */
let holdsKept = kept !== null;
function useStaleDraft(): void {
  if (stale.value === null) return;
  holdsKept = true;
  draft.value = stale.value.text.replace(/\r\n?/g, "\n");
  stale.value = null;
  notice.value = null;
}
const opened = props.text.replace(/\r\n?/g, "\n");
/** This memory, a blank line, then the other's body: only the line breaks where they join are
 *  dropped, so a hard break's spaces or a body opening with an indented block stay as they were. */
function mergedDraft(body: string): string {
  const kept = withoutTrailingBreaks(opened);
  const added = body.replace(/\r\n?/g, "\n").replace(/^\n+/, "");
  const ending = added.endsWith("\n") ? "" : "\n";
  return [kept, "\n\n", added, ending].join("");
}
// Indexed by UTF-16 unit, as `slice` is: spreading the string would count an emoji once and cut the end.
const withoutTrailingBreaks = (text: string): string =>
  text.slice(
    0,
    text.split("").reduce((end, char, at) => (char === "\n" ? end : at + 1), 0),
  );
const draft = ref(seeded ? mergedDraft(seeded.body) : (kept?.text ?? props.text).replace(/\r\n?/g, "\n"));
/** The draft as it goes to disk: an untouched draft is the file exactly as it was (mixed line endings
 *  included); an edited one takes CRLF throughout when the file had any. */
const asWritten = (text: string): string => {
  if (text === opened) return props.text;
  return crlf ? text.replace(/\n/g, "\r\n") : text;
};
/** The draft differs from what was opened: leaving would lose it. */
const dirty = computed(() => asWritten(draft.value) !== props.text);
defineExpose({ dirty });
const saving = ref(false);
const notice = ref<"changed" | "from-changed" | "links-changed" | "unplaceable" | "failed" | "too-large" | "unsaved" | "restored" | null>(
  kept === null ? null : "restored",
);
/** A merge's links to the memory merged in, said before saving: how many will point here, and the
 *  memories whose links could not be rewritten (which stop the merge). */
const mergeLinks = ref<{ count: number; unplaceable: string[] } | null>(null);
watch(
  () => props.leaveRefused,
  () => (notice.value = "unsaved"),
);
/** A session is running in this project: it may write this memory while it is edited. */
const sessionRunning = ref(false);
const field = useTemplateRef<HTMLTextAreaElement>("field");

/** Saved or cancelled: the draft has been dealt with, and leaving keeps nothing. */
let settled = false;

// Gone with an unsaved draft (the Library closed, the kind switched): kept for next time.
onBeforeUnmount(() => {
  if (!settled && !seeded && dirty.value) keepMemoryDraft(draftKey, { version: props.version, text: asWritten(draft.value) });
});

/** Read the file again after a conflict: the draft is given up, as the notice said. */
function reload(): void {
  settled = true;
  if (holdsKept) dropMemoryDraft(draftKey);
  emit("reload");
}

function cancel(): void {
  // Not while a save is on its way: it would land with no one left to say so.
  if (saving.value) return;
  settled = true;
  if (holdsKept) dropMemoryDraft(draftKey);
  emit("cancel");
}

// One counter for the mount's check and each showing's, so an older answer cannot undo a newer one.
let runningChecks = 0;
async function recheckRunning(): Promise<void> {
  const mine = ++runningChecks;
  const running = await sessionRunningIn(props.cwd);
  if (mine === runningChecks) sessionRunning.value = running;
}
onOverlayShownAgain(() => void recheckRunning());

onMounted(async () => {
  await nextTick();
  field.value?.focus();
  const merging = props.merging;
  void recheckRunning();
  const links = merging ? await loadLibraryMemoryLinks(props.slug, props.file, merging.file) : null;
  mergeLinks.value = links;
  // Said before saving, as the merge would be refused for it.
  if ((links?.unplaceable.length ?? 0) > 0) notice.value = "unplaceable";
});
// The editor stays open while the Library is closed; a session may have started or ended in the meantime.

async function save(): Promise<void> {
  if (saving.value) return;
  if (new TextEncoder().encode(asWritten(draft.value)).length > MEMORY_EDIT_MAX_BYTES) {
    notice.value = "too-large";
    return;
  }
  saving.value = true;
  const text = asWritten(draft.value);
  if (props.merging) await merge(text, props.merging);
  else saved(text, await saveLibraryMemoryFile(props.slug, props.file, text, props.version));
  saving.value = false;
}

function saved(text: string, result: MemorySaveResult): void {
  if (result.kind !== "saved") {
    notice.value = result.kind;
    return;
  }
  settled = true;
  if (holdsKept) dropMemoryDraft(draftKey);
  emit("saved", text, result.version);
}

async function merge(text: string, merging: NonNullable<typeof props.merging>): Promise<void> {
  const request = { slug: props.slug, into: props.file, text, version: props.version, from: merging.file, fromVersion: merging.version };
  const result = await mergeLibraryMemoryFiles(request);
  if (result.kind === "merged") {
    settled = true;
    emit("merged", result.text, result.version, result.undo, result.links);
    return;
  }
  if (result.kind === "unplaceable") mergeLinks.value = { count: 0, unplaceable: result.files };
  notice.value = result.kind === "changed" && result.file !== "into" ? `${result.file}-changed` : result.kind;
}

/** ⌘Enter (Ctrl+Enter elsewhere) saves; Esc stops editing, not the Library. */
function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    // Never the Library's: it would close it with the edit open.
    event.stopPropagation();
    // Esc while composing (Japanese input) cancels the composition, not the edit — Safari's
    // compositionend-before-keydown included.
    if (isImeConfirming(event)) return;
    event.preventDefault();
    cancel();
  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !isImeConfirming(event)) {
    event.preventDefault();
    event.stopPropagation();
    void save();
  }
}
</script>

<template>
  <!-- Keys on the whole editor, so Esc from a button ends the edit too, not the Library. -->
  <div class="flex min-h-0 flex-1 flex-col" data-testid="memory-editor" @keydown="onKey">
    <p v-if="stale" class="m-0 px-4 pt-3 font-sans text-[12px] text-secondary" role="status" data-testid="memory-editor-stale">
      {{ t("libraryView.memory.edit.staleDraft") }}
      <button
        type="button"
        class="ml-1 cursor-pointer border-0 bg-transparent p-0 font-sans text-[12px] text-accent hover:underline"
        data-testid="memory-editor-use-stale"
        @click="useStaleDraft"
      >
        {{ t("libraryView.memory.edit.useStale") }}
      </button>
    </p>
    <p v-if="merging" class="m-0 px-4 pt-3 font-sans text-[12px] text-secondary" role="status" data-testid="memory-editor-merging">
      {{ t("libraryView.memory.merge.editing", { title: merging.title }) }}
      <span v-if="mergeLinks && mergeLinks.count > 0" data-testid="memory-editor-merge-links">{{
        t("libraryView.memory.merge.links", { count: mergeLinks.count })
      }}</span>
    </p>
    <p v-if="adding" class="m-0 px-4 pt-3 font-sans text-[12px] text-secondary" role="status" data-testid="memory-editor-adding">
      {{ t("libraryView.memory.copies.editing", { name: adding.title }) }}
    </p>
    <p v-if="sessionRunning" class="m-0 px-4 pt-3 font-sans text-[12px] text-warn" role="status" data-testid="memory-editor-running">
      {{ t("libraryView.memory.edit.running") }}
    </p>
    <textarea
      ref="field"
      v-model="draft"
      class="m-4 min-h-0 flex-1 resize-none rounded border border-border bg-transparent p-3 font-mono text-[13px] leading-[1.6] text-fg outline-none focus:border-accent"
      :aria-label="t('libraryView.memory.edit.label')"
      spellcheck="false"
      data-testid="memory-editor-field"
      :readonly="saving"
    ></textarea>
    <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2">
      <p v-if="notice" class="m-0 mr-auto font-sans text-[12px] text-err-text" role="status" data-testid="memory-editor-notice">
        {{ t(`libraryView.memory.edit.${notice}`, { files: (mergeLinks?.unplaceable ?? []).join(", ") }) }}
        <button
          v-if="notice === 'changed' || notice === 'from-changed'"
          type="button"
          class="ml-1 cursor-pointer border-0 bg-transparent p-0 font-sans text-[12px] text-accent hover:underline"
          @click="reload"
        >
          {{ t("libraryView.memory.edit.reload") }}
        </button>
      </p>
      <button
        type="button"
        class="cursor-pointer rounded border border-border bg-transparent px-3 py-1.5 font-sans text-[13px] text-secondary hover:text-fg"
        data-testid="memory-editor-cancel"
        :disabled="saving"
        @click="cancel"
      >
        {{ t("libraryView.memory.edit.cancel") }} <kbd class="font-sans text-[11px] text-dim">Esc</kbd>
      </button>
      <button
        type="button"
        class="flex cursor-pointer items-center gap-2 rounded-[6px] border-0 bg-accent px-4 py-2 font-sans text-[13px] font-semibold text-on-accent disabled:opacity-60"
        :disabled="saving"
        data-testid="memory-editor-save"
        @click="save"
      >
        {{ t("libraryView.memory.edit.save") }} <kbd class="font-sans text-[11px] opacity-80">⌘Enter</kbd>
      </button>
    </footer>
  </div>
</template>
