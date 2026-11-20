<script setup lang="ts">
// Editing one memory in place (#3331): its whole text, frontmatter and all, so nothing the file holds is
// lost on the way back. Saved only over the text it was opened on — the agent writes memory as it
// works, and a save over its change would lose it without a word.
import { nextTick, onMounted, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { saveLibraryMemoryFile } from "../../composables/libraryApi";
import { readResumableList } from "../../composables/useDirLists";
import { MEMORY_EDIT_MAX_BYTES } from "../../../common/libraryMemory";

const props = defineProps<{ slug: string; file: string; text: string; version: string; cwd: string | null }>();
const emit = defineEmits<{ (e: "saved", text: string, version: string): void; (e: "cancel" | "reload"): void }>();
const { t } = useI18n();

const draft = ref(props.text);
const saving = ref(false);
const notice = ref<"changed" | "failed" | "too-large" | null>(null);
/** A session is running in this project: it may write this memory while it is edited. */
const sessionRunning = ref(false);
const field = useTemplateRef<HTMLTextAreaElement>("field");

onMounted(async () => {
  await nextTick();
  field.value?.focus();
  const list = props.cwd === null ? null : await readResumableList(props.cwd, "claude");
  sessionRunning.value = (list?.sessions ?? []).some((session) => (session.runningKey ?? null) !== null);
});

async function save(): Promise<void> {
  if (saving.value) return;
  if (new TextEncoder().encode(draft.value).length > MEMORY_EDIT_MAX_BYTES) {
    notice.value = "too-large";
    return;
  }
  saving.value = true;
  const result = await saveLibraryMemoryFile(props.slug, props.file, draft.value, props.version);
  saving.value = false;
  if (result.kind === "saved") emit("saved", draft.value, result.version);
  else notice.value = result.kind;
}

/** ⌘Enter (Ctrl+Enter elsewhere) saves; Esc stops editing, not the Library. */
function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("cancel");
  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
    event.preventDefault();
    event.stopPropagation();
    void save();
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="memory-editor">
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
      @keydown="onKey"
    ></textarea>
    <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2">
      <p v-if="notice" class="m-0 mr-auto font-sans text-[12px] text-err-text" role="status" data-testid="memory-editor-notice">
        {{ t(`libraryView.memory.edit.${notice}`) }}
        <button
          v-if="notice === 'changed'"
          type="button"
          class="ml-1 cursor-pointer border-0 bg-transparent p-0 font-sans text-[12px] text-accent hover:underline"
          @click="emit('reload')"
        >
          {{ t("libraryView.memory.edit.reload") }}
        </button>
      </p>
      <button
        type="button"
        class="cursor-pointer rounded border border-border bg-transparent px-3 py-1.5 font-sans text-[13px] text-secondary hover:text-fg"
        data-testid="memory-editor-cancel"
        @click="emit('cancel')"
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
