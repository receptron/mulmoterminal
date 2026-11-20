<script setup lang="ts">
// Choosing the memory to merge the one being read into (#3331): the others of its project, in the
// reader in place of the body. Esc goes back to reading, not out of the Library.
import { nextTick, onMounted, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { movedIndex } from "./libraryKeys";

defineProps<{ title: string; choices: { key: string; title: string; file: string }[] }>();
const emit = defineEmits<{ (e: "pick", key: string): void; (e: "cancel"): void }>();
const { t } = useI18n();
const chooser = useTemplateRef<HTMLElement>("chooser");

onMounted(async () => {
  await nextTick();
  // The first choice, or Cancel when there is none: focus inside, so Esc is the chooser's.
  chooser.value?.querySelector("button")?.focus();
});

/** The arrows move between the choices, held at either end, as they move through the list. */
function moveFocus(by: number): void {
  const choices = [...(chooser.value?.querySelectorAll<HTMLButtonElement>("[data-testid=memory-merge-choice]") ?? [])];
  const at = choices.findIndex((choice) => choice === document.activeElement);
  choices[movedIndex(at, by, choices.length)]?.focus();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") moveFocus(event.key === "ArrowDown" ? 1 : -1);
  else if (event.key === "Escape") emit("cancel");
  else return;
  event.stopPropagation();
  event.preventDefault();
}
</script>

<template>
  <div ref="chooser" class="min-h-0 flex-1 overflow-y-auto border-t border-border px-4 py-3" data-testid="memory-merge-chooser" @keydown="onKey">
    <p class="m-0 mb-2 font-sans text-[13px] text-secondary">{{ t("libraryView.memory.merge.choose", { title }) }}</p>
    <p v-if="choices.length === 0" class="m-0 font-sans text-[13px] text-dim">{{ t("libraryView.memory.merge.none") }}</p>
    <div class="flex flex-col">
      <button
        v-for="choice in choices"
        :key="choice.key"
        type="button"
        class="block w-full cursor-pointer rounded border-0 bg-transparent px-2 py-1.5 text-left font-sans hover:bg-hover focus:bg-hover"
        data-testid="memory-merge-choice"
        @click="emit('pick', choice.key)"
      >
        <span class="block truncate text-[13px] text-fg">{{ choice.title }}</span>
        <span class="block truncate font-mono text-[12px] text-dim">{{ choice.file }}</span>
      </button>
    </div>
    <button
      type="button"
      class="mt-3 cursor-pointer rounded border border-border bg-transparent px-3 py-1.5 font-sans text-[13px] text-secondary hover:text-fg"
      data-testid="memory-merge-cancel"
      @click="emit('cancel')"
    >
      {{ t("libraryView.memory.merge.cancel") }} <kbd class="font-sans text-[11px] text-dim">Esc</kbd>
    </button>
  </div>
</template>
