<script setup lang="ts">
// The Library's list (#3329): one row per conversation — the title, and one grey line saying where
// and when. Grouped by day while browsing; flat, newest first, with the matching words while searching.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { LibraryConversation, LibrarySearchHit } from "../../../common/library";
import { conversationKey, groupConversations, metaParts } from "./libraryRows";

const props = defineProps<{
  conversations: readonly LibraryConversation[];
  hits: readonly LibrarySearchHit[] | null;
  selectedKey: string | null;
  now: number;
  hasMore: boolean;
}>();
const emit = defineEmits<{ select: [conversation: LibraryConversation]; more: [] }>();
const { t, locale } = useI18n();

const groups = computed(() => groupConversations(props.conversations, props.now));
const meta = (conversation: LibraryConversation): string => metaParts(conversation, props.now, locale.value).join(" · ");
const title = (conversation: LibraryConversation): string => conversation.title ?? t("libraryView.untitled");
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto py-1" data-testid="library-list">
    <template v-if="hits">
      <button
        v-for="hit in hits"
        :key="conversationKey(hit.conversation)"
        type="button"
        data-testid="library-row"
        data-library-row
        class="block w-full cursor-pointer border-0 border-l-2 px-4 py-2 text-left font-sans"
        :class="conversationKey(hit.conversation) === selectedKey ? 'border-accent bg-hover' : 'border-transparent bg-transparent hover:bg-hover'"
        :aria-current="conversationKey(hit.conversation) === selectedKey"
        @click="emit('select', hit.conversation)"
      >
        <span class="block truncate text-[14px] text-fg">{{ title(hit.conversation) }}</span>
        <span class="block truncate text-[12px] text-dim">{{ meta(hit.conversation) }}</span>
        <span v-if="hit.snippet" class="mt-1 line-clamp-2 text-[12px] text-secondary">{{ hit.snippet }}</span>
      </button>
    </template>
    <template v-else>
      <section v-for="rows in groups" :key="rows.group">
        <h3 class="m-0 px-4 pb-1 pt-3 font-sans text-[11px] font-semibold text-dim">{{ t(`libraryView.groups.${rows.group}`) }}</h3>
        <button
          v-for="conversation in rows.conversations"
          :key="conversationKey(conversation)"
          type="button"
          data-testid="library-row"
          data-library-row
          class="block w-full cursor-pointer border-0 border-l-2 px-4 py-2 text-left font-sans"
          :class="conversationKey(conversation) === selectedKey ? 'border-accent bg-hover' : 'border-transparent bg-transparent hover:bg-hover'"
          :aria-current="conversationKey(conversation) === selectedKey"
          @click="emit('select', conversation)"
        >
          <span class="block truncate text-[14px] text-fg">{{ title(conversation) }}</span>
          <span class="block truncate text-[12px] text-dim">{{ meta(conversation) }}</span>
        </button>
      </section>
      <button
        v-if="hasMore"
        type="button"
        data-testid="library-more"
        class="mx-4 my-2 cursor-pointer rounded border border-border bg-transparent px-3 py-1 font-sans text-[12px] text-secondary hover:bg-hover hover:text-fg"
        @click="emit('more')"
      >
        {{ t("libraryView.more") }}
      </button>
    </template>
  </div>
</template>
