<script setup lang="ts">
// The Library (#3329; design in docs/library-design.md): every Claude conversation on this machine,
// searchable, readable, and resumable where it ran. A search field, the kinds (conversations only,
// for now), and list | reader — one column at phone width, where choosing a row opens the reader.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import FullScreenOverlay from "../FullScreenOverlay.vue";
import LibraryList from "./LibraryList.vue";
import LibraryReader from "./LibraryReader.vue";
import { useLibraryView } from "../../composables/useLibraryView";
import { useEscapeToClose } from "../../composables/useEscapeToClose";
import { useLibraryData } from "../../composables/useLibraryData";
import { readResumableList } from "../../composables/useDirLists";
import { openCellAt } from "../../composables/useNewTerminal";
import { paletteTerminals } from "../../composables/commandPalette";
import { cellForPanelResume } from "../launchCell";
import { isEditableTarget } from "../../composables/gridShortcut";
import { libraryKeyAction, movedIndex } from "./libraryKeys";
import { libraryResume, type LibraryResume } from "./libraryResume";
import type { LibraryConversation } from "../../../common/library";

const { t } = useI18n();
const { isOpen, close } = useLibraryView();
useEscapeToClose(isOpen, close);
const { conversations, hasMore, loaded, loadFailed, status, query, hits, searching, searchFailed, loadMore } = useLibraryData(isOpen);

const searchField = ref<HTMLInputElement | null>(null);
const chosen = shallowRef<LibraryConversation | null>(null);
/** At phone width the reader replaces the list; this says which one is showing there. */
const readerShown = ref(false);
const notice = ref<string | null>(null);
const now = ref(Date.now());

/** What the list shows right now, in order — what the arrow keys walk. */
const shown = computed((): LibraryConversation[] => (hits.value ? hits.value.map((hit) => hit.conversation) : conversations.value));
// The chosen row while it is still shown, else the first one: Enter always has something to act on.
const selected = computed(() => shown.value.find((c) => c === chosen.value) ?? shown.value[0] ?? null);
// Only the FIRST build is worth a line: later passes catch up in seconds on what was appended, and a
// progress line every time the screen opens would read as the Library being slow.
const progress = computed(() => {
  const s = status.value;
  if (!s?.indexing || s.finishedAt !== null) return null;
  return s.filesTotal > 0 ? t("libraryView.indexing", { done: s.filesDone, total: s.filesTotal }) : t("libraryView.indexingStart");
});

// Immediate, so a screen opened by loading /library directly starts in the search field too.
watch(
  isOpen,
  async (open) => {
    chosen.value = null;
    readerShown.value = false;
    notice.value = null;
    now.value = Date.now();
    if (!open) return;
    await nextTick();
    searchField.value?.focus();
  },
  { immediate: true },
);
watch(selected, () => (notice.value = null));

const RESUME_REFUSALS: Record<Exclude<LibraryResume["kind"], "open">, string> = {
  busy: "libraryView.resumeBusy",
  "no-cwd": "libraryView.resumeNoCwd",
  unchecked: "libraryView.resumeUnchecked",
};

function select(conversation: LibraryConversation): void {
  chosen.value = conversation;
  readerShown.value = true;
}

function move(by: number): void {
  const index = selected.value ? shown.value.indexOf(selected.value) : -1;
  chosen.value = shown.value[movedIndex(index, by, shown.value.length)] ?? null;
}

/** One resume at a time: a second Enter while the first is still checking would open it twice. */
let resuming = false;
async function resume(): Promise<void> {
  const conversation = selected.value;
  if (conversation === null || resuming) return;
  resuming = true;
  try {
    await resumeConversation(conversation);
  } finally {
    resuming = false;
  }
}

async function resumeConversation(conversation: LibraryConversation): Promise<void> {
  const list = conversation.cwd === null ? null : await readResumableList(conversation.cwd, "claude");
  const decision = libraryResume(conversation, list, paletteTerminals.value?.openSessionIds() ?? []);
  if (decision.kind !== "open") {
    notice.value = t(RESUME_REFUSALS[decision.kind]);
    return;
  }
  openCellAt(cellForPanelResume({ id: decision.id, cwd: decision.cwd, agent: "claude", account: decision.account }), null);
}

const OTHER_CONTROLS = "button, a[href], summary, [role=button], [contenteditable=true]";

function onKey(event: KeyboardEvent): void {
  if (!isOpen.value) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const inSearch = target !== null && searchField.value?.isSameNode(target) === true;
  const editable = target !== null && isEditableTarget(target.tagName, [...target.classList]);
  const modified = event.metaKey || event.ctrlKey || event.altKey;
  const onOtherControl = target?.closest(OTHER_CONTROLS) != null && target.closest("[data-library-row]") === null;
  const action = libraryKeyAction({ key: event.key, inSearch, inOtherField: editable && !inSearch, onOtherControl, composing: event.isComposing, modified });
  if (action === null) return;
  event.preventDefault();
  if (action === "focus-search") searchField.value?.focus();
  else if (action === "primary") void resume();
  else move(action === "up" ? -1 : 1);
}
window.addEventListener("keydown", onKey);
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <FullScreenOverlay v-if="isOpen" :region-label="t('libraryView.region')" :close-label="t('libraryView.close')" @close="close">
    <template #header>
      <span class="font-sans text-[14px] font-[650] text-fg">{{ t("libraryView.title") }}</span>
      <span class="hidden font-sans text-[12px] text-dim sm:inline">{{ t("libraryView.shortcuts") }}</span>
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <div class="px-4 pb-2 pt-3">
        <label class="flex items-center gap-2 rounded-[6px] border border-border bg-base px-3 py-2 focus-within:border-accent">
          <span class="material-symbols-outlined text-[18px] text-dim">search</span>
          <input
            ref="searchField"
            v-model="query"
            type="search"
            data-testid="library-search"
            :placeholder="t('libraryView.search')"
            :aria-label="t('libraryView.search')"
            class="min-w-0 flex-1 border-0 bg-transparent font-sans text-[14px] text-fg outline-none"
          />
          <kbd class="rounded border border-border px-1 font-sans text-[11px] text-dim">/</kbd>
        </label>
        <div class="mt-2 flex items-center gap-3 font-sans text-[13px]">
          <span class="rounded bg-hover px-2 py-1 text-fg">
            {{ t("libraryView.kinds.conversations") }}
            <span class="text-dim">{{ hits ? hits.length : conversations.length }}{{ hasMore && !hits ? "+" : "" }}</span>
          </span>
          <span v-if="progress" class="text-dim" role="status" data-testid="library-progress">{{ progress }}</span>
          <span v-else-if="searching" class="text-dim">{{ t("libraryView.searching") }}</span>
        </div>
      </div>

      <p v-if="loadFailed" class="m-0 px-4 py-6 font-sans text-[13px] text-err-text">{{ t("libraryView.loadFailed") }}</p>
      <p v-else-if="!loaded" class="m-0 px-4 py-6 font-sans text-[13px] text-dim">{{ t("libraryView.loading") }}</p>
      <p v-else-if="searchFailed && !searching" class="m-0 px-4 py-6 font-sans text-[13px] text-err-text" data-testid="library-search-failed">
        {{ t("libraryView.searchFailed") }}
      </p>
      <p v-else-if="hits && !hits.length && !searching" class="m-0 px-4 py-6 font-sans text-[13px] text-dim" data-testid="library-no-match">
        {{ t("libraryView.noMatch", { query: query.trim() }) }}
      </p>
      <p v-else-if="!hits && !conversations.length" class="m-0 px-4 py-6 font-sans text-[13px] text-dim">{{ t("libraryView.empty") }}</p>

      <div v-else class="flex min-h-0 flex-1 border-t border-border">
        <div
          class="flex min-h-0 w-[360px] flex-none flex-col border-r border-border max-[760px]:w-full max-[760px]:border-r-0"
          :class="readerShown ? 'max-[760px]:hidden' : ''"
        >
          <LibraryList
            :conversations="conversations"
            :hits="hits"
            :selected-id="selected?.id ?? null"
            :now="now"
            :has-more="hasMore"
            @select="select"
            @more="loadMore"
          />
        </div>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col" :class="readerShown ? '' : 'max-[760px]:hidden'">
          <button
            type="button"
            class="hidden cursor-pointer items-center gap-1 border-0 bg-transparent px-4 pt-3 font-sans text-[13px] text-secondary max-[760px]:flex"
            data-testid="library-back"
            @click="readerShown = false"
          >
            <span class="material-symbols-outlined text-[18px]">arrow_back</span>{{ t("libraryView.back") }}
          </button>
          <LibraryReader v-if="selected" :conversation="selected" :now="now" :notice="notice" @resume="resume" />
          <p v-else class="m-0 p-6 font-sans text-[13px] text-dim">{{ t("libraryView.pick") }}</p>
        </div>
      </div>
    </div>
  </FullScreenOverlay>
</template>
