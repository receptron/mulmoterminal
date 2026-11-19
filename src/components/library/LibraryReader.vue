<script setup lang="ts">
// One conversation, read (#3329): its title, one grey line of facts — including the cost and the
// lines it changed, which the list leaves out — and the conversation itself, through the same
// transcript view the terminal's side pane uses.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import TranscriptPane from "../TranscriptPane.vue";
import type { LibraryConversation } from "../../../common/library";
import { costLabel, metaParts } from "./libraryRows";

const props = defineProps<{ conversation: LibraryConversation; now: number; notice: string | null }>();
const emit = defineEmits<{ resume: [] }>();
const { t, locale } = useI18n();

const facts = computed(() => {
  const parts = metaParts(props.conversation, props.now, locale.value);
  const cost = costLabel(props.conversation.costUsd, locale.value);
  return cost === null ? parts : [...parts, cost];
});
const lines = computed(() => {
  const { linesAdded, linesRemoved } = props.conversation;
  return linesAdded === null && linesRemoved === null ? null : { added: linesAdded ?? 0, removed: linesRemoved ?? 0 };
});
</script>

<template>
  <article class="relative flex min-h-0 min-w-0 flex-1 flex-col" data-testid="library-reader">
    <header class="px-4 pb-2 pt-5">
      <h2 class="m-0 text-balance font-sans text-[20px] font-[650] text-fg">{{ conversation.title ?? t("libraryView.untitled") }}</h2>
      <p class="m-0 mt-1 flex flex-wrap gap-x-3 font-sans text-[12px] text-dim">
        <span v-for="fact in facts" :key="fact">{{ fact }}</span>
        <span v-if="lines" class="font-mono"
          ><span class="text-ok">+{{ lines.added }}</span> <span class="text-err-text">−{{ lines.removed }}</span></span
        >
      </p>
    </header>
    <div class="flex min-h-0 flex-1">
      <TranscriptPane :key="conversation.id" :session-id="conversation.id" :cwd="conversation.cwd" :agent="conversation.agent" embedded />
    </div>
    <footer class="pointer-events-none absolute bottom-4 right-6 flex items-center gap-3">
      <span v-if="notice" class="pointer-events-auto rounded bg-panel px-3 py-1 font-sans text-[12px] text-secondary" role="status">{{ notice }}</span>
      <button
        type="button"
        data-testid="library-resume"
        class="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-[6px] border-0 bg-accent px-4 py-2 font-sans text-[13px] font-semibold text-on-accent"
        @click="emit('resume')"
      >
        <span class="material-symbols-outlined text-[18px]">play_arrow</span>
        {{ t("libraryView.resume") }}
        <kbd class="rounded border border-on-accent/40 px-1 font-sans text-[11px] font-normal">Enter</kbd>
      </button>
    </footer>
  </article>
</template>
