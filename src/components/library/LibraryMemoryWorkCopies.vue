<script setup lang="ts">
// The other work copies holding this memory (#3331), in the reader: which hold the same text, and for
// one that differs, taking its text in here or writing this text there, so the copies become one.
import { useI18n } from "vue-i18n";
import { parseMemoryFrontmatter } from "../../../common/libraryMemory";
import { loadLibraryMemoryFile } from "../../composables/libraryApi";
import { useWorkCopyWrite, type WorkCopyTarget } from "../../composables/useWorkCopyWrite";

defineProps<{
  copies: (WorkCopyTarget & { same: boolean })[];
  /** This memory's text as saved, or null while it is not read (or cannot be). */
  text: string | null;
}>();
const emit = defineEmits<{ (e: "add", name: string, body: string): void; (e: "changed"): void }>();
const { t } = useI18n();
const { notice, writeThere, undo, dismiss } = useWorkCopyWrite(() => emit("changed"));

/** The copy's body, for the editor to add to this memory. */
async function addHere(copy: WorkCopyTarget): Promise<void> {
  const there = await loadLibraryMemoryFile(copy.slug, copy.file);
  if (there?.text == null) return;
  emit("add", copy.name, parseMemoryFrontmatter(there.text).body);
}

function noticeText(): string {
  const shown = notice.value;
  if (shown === null) return "";
  if (shown.kind !== "written") return t(`libraryView.memory.copies.${shown.kind}`, { name: shown.name });
  if (shown.undoFailed === true) return t("libraryView.memory.copies.undo-failed", { name: shown.name });
  const done = t("libraryView.memory.copies.written", { name: shown.name });
  return shown.running ? `${done} ${t("libraryView.memory.copies.running")}` : done;
}

const ACTION = "cursor-pointer border-0 bg-transparent p-0 font-sans text-[12px] text-accent hover:underline disabled:cursor-default disabled:text-dim";
</script>

<template>
  <div class="mt-2 font-sans text-[13px]" data-testid="memory-work-copies">
    <p class="m-0 text-warn">{{ t("libraryView.memory.copies.intro") }}</p>
    <ul class="m-0 mt-1 flex list-none flex-col gap-1 p-0">
      <li v-for="copy in copies" :key="copy.slug" class="flex flex-wrap items-baseline gap-x-3" data-testid="memory-work-copy">
        <span class="text-secondary">{{ t(copy.same ? "libraryView.memory.copySame" : "libraryView.memory.copyDiffers", { name: copy.name }) }}</span>
        <template v-if="!copy.same">
          <button type="button" :class="ACTION" data-testid="memory-copy-add" @click="addHere(copy)">{{ t("libraryView.memory.copies.add") }}</button>
          <button type="button" :class="ACTION" :disabled="text === null" data-testid="memory-copy-write" @click="text !== null && writeThere(copy, text)">
            {{ t("libraryView.memory.copies.write") }}
          </button>
        </template>
      </li>
    </ul>
    <p v-if="notice" class="m-0 mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-secondary" role="status" data-testid="memory-copy-notice">
      <span class="min-w-0">{{ noticeText() }}</span>
      <button v-if="notice.kind === 'written'" type="button" :class="ACTION" class="font-semibold" data-testid="memory-copy-undo" @click="undo">
        {{ t("libraryView.memory.trash.undo") }}
      </button>
      <button
        type="button"
        class="flex cursor-pointer items-center border-0 bg-transparent p-0 text-dim hover:text-fg"
        :aria-label="t('libraryView.memory.trash.dismiss')"
        @click="dismiss"
      >
        <span class="material-symbols-outlined text-[16px]">close</span>
      </button>
    </p>
  </div>
</template>
