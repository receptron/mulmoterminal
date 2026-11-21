<script setup lang="ts">
// The Library (#3329; design in docs/library-design.md): every Claude conversation on this machine,
// searchable, readable, and resumable where it ran. A search field, the kinds (conversations only,
// for now), and list | reader — one column at phone width, where choosing a row opens the reader.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import FullScreenOverlay from "../FullScreenOverlay.vue";
import LibraryList from "./LibraryList.vue";
import LibraryReader from "./LibraryReader.vue";
import LibraryMemory from "./LibraryMemory.vue";
import LibraryTools from "./LibraryTools.vue";
import { filterMemory } from "./memoryRows";
import { useLibraryMemory } from "../../composables/useLibraryMemory";
import { libraryRequested, useLibraryView } from "../../composables/useLibraryView";
import { loadLibraryConversation } from "../../composables/libraryApi";
import { router } from "../../router";
import { useEscapeToClose } from "../../composables/useEscapeToClose";
import { isImeConfirming } from "../../composables/imeComposition";
import { useLibraryData } from "../../composables/useLibraryData";
import { readResumableList } from "../../composables/useDirLists";
import { openCellAt } from "../../composables/useNewTerminal";
import { paletteTerminals } from "../../composables/commandPalette";
import { cellForPanelResume } from "../launchCell";
import { isEditableTarget } from "../../composables/gridShortcut";
import { libraryKeyAction, movedFromGap, movedIndex } from "./libraryKeys";
import { libraryResume, type LibraryResume } from "./libraryResume";
import { startPromote } from "./libraryPromoteStart";
import type { PromoteTarget } from "../../../common/libraryPromote";
import { conversationKey, groupConversations, listedInOrder } from "./libraryRows";
import { useLibraryMarks } from "../../composables/useLibraryMarks";
import type { LibraryConversation } from "../../../common/library";
import LibraryStorage from "./LibraryStorage.vue";
import { useLibraryStorage } from "../../composables/useLibraryStorage";

const { t } = useI18n();
const { isOpen, close } = useLibraryView();
useEscapeToClose(isOpen, close);
const { conversations, hasMore, loaded, loadFailed, status, query, hits, searching, searchFailed, loadMore } = useLibraryData(isOpen);
const {
  projects: memoryProjects,
  loaded: memoryLoaded,
  failed: memoryFailed,
  health: memoryHealth,
  healthFailed: memoryHealthFailed,
  refresh: refreshMemory,
} = useLibraryMemory(isOpen);
const memoryCount = computed(() => filterMemory(memoryProjects.value, query.value).reduce((sum, project) => sum + project.files.length, 0));
/** Which kind the list shows: the conversations, Claude Code's memory, its tools, or what its home takes. */
const kind = ref<"conversations" | "memory" | "tools" | "storage">("conversations");
const SHORTCUTS = {
  conversations: "libraryView.shortcuts",
  memory: "libraryView.memory.shortcuts",
  tools: "libraryView.tools.shortcuts",
  storage: "libraryView.storage.shortcuts",
} as const;
const SEARCH_LABELS = {
  conversations: "libraryView.search",
  memory: "libraryView.memory.search",
  tools: "libraryView.tools.search",
  storage: "libraryView.storage.search",
} as const;
const searchLabel = computed(() => t(SEARCH_LABELS[kind.value]));
const memoryView = useTemplateRef<{ move(by: number): Promise<void>; startEdit(): void }>("memoryView");
const toolsView = useTemplateRef<{ move(by: number): Promise<void> }>("toolsView");
const storageView = useTemplateRef<{ move(by: number): Promise<void> }>("storageView");
const storage = useLibraryStorage(
  computed(() => isOpen.value && kind.value === "storage"),
  query,
);
const { marks, pinned, saveFailedFor, loadFailed: marksFailed, change: changeMark } = useLibraryMarks(isOpen);

const searchField = ref<HTMLInputElement | null>(null);
/** The chosen row by key, not by object: a reload replaces every object, and must not move the reader. */
const chosenKey = ref<string | null>(null);
/** At phone width the reader replaces the list; this says which one is showing there. */
const readerShown = ref(false);
const notice = ref<string | null>(null);
const now = ref(Date.now());

/** What the list shows right now, in order — what the arrow keys walk. */
const shown = computed((): LibraryConversation[] =>
  hits.value
    ? hits.value.map((hit) => hit.conversation)
    : listedInOrder(groupConversations(conversations.value, now.value, pinned.value, new Set(marks.value.pinned))),
);
// The chosen row while it is still shown, else the first one: Enter always has something to act on.
/** The chosen conversation as last seen, kept so the reader stays on it if it leaves the list — an
 *  unpinned one that is not on the pages read so far, say — until another is chosen. */
const chosenSeen = shallowRef<LibraryConversation | null>(null);
const selected = computed(
  () =>
    shown.value.find((c) => conversationKey(c) === chosenKey.value) ??
    // Held only while browsing: in search results, the row Enter acts on must be one of the results.
    (!hits.value && chosenSeen.value !== null && conversationKey(chosenSeen.value) === chosenKey.value ? chosenSeen.value : null) ??
    shown.value[0] ??
    null,
);
// Only the FIRST build is worth a line: later passes catch up in seconds on what was appended, and a
// progress line every time the screen opens would read as the Library being slow.
const progress = computed(() => {
  const s = status.value;
  if (!s?.indexing || s.finishedAt !== null) return null;
  return s.filesTotal > 0 ? t("libraryView.indexing", { done: s.filesDone, total: s.filesTotal }) : t("libraryView.indexingStart");
});

/** The clock the "when" labels and the day groups are read against, kept current while open — a
 *  screen left open past midnight would otherwise go on calling yesterday "today". */
const CLOCK_TICK_MS = 60_000;
let clock: ReturnType<typeof setInterval> | null = null;
function runClock(open: boolean): void {
  if (clock !== null) clearInterval(clock);
  clock = open ? setInterval(() => (now.value = Date.now()), CLOCK_TICK_MS) : null;
}

/** Bumped on every open and close: a resume that began before either must not land after it. */
let openings = 0;
// Immediate, so a screen opened by loading /library directly starts in the search field too.
watch(
  isOpen,
  async (open) => {
    openings++;
    chosenKey.value = null;
    readerShown.value = false;
    notice.value = null;
    now.value = Date.now();
    runClock(open);
    if (!open) return;
    await nextTick();
    searchField.value?.focus();
    void focusRequested();
  },
  { immediate: true },
);
// Opened again on another conversation while already open (a second cell's History menu).
watch(
  () => [router.currentRoute.value.query.session, router.currentRoute.value.query.cwd],
  () => {
    if (isOpen.value) void focusRequested();
  },
);

/** Opens the reader on the conversation the URL names (a cell's History menu), reading it by id when
 *  it is not on the pages the list has read. */
let focusRequests = 0;
async function focusRequested(): Promise<void> {
  const mine = ++focusRequests; // even with nothing asked: a plain open withdraws an earlier request
  const request = libraryRequested();
  if (request === null) return;
  const opening = openings;
  const loaded = [...pinned.value, ...conversations.value];
  // Only an exact copy is taken from the list; anything else is the server's choice (the newest).
  const listed = request.cwd === null ? undefined : loaded.find((c) => c.id === request.session && c.cwd === request.cwd);
  const found = listed ?? (await loadLibraryConversation(request.session, request.cwd));
  // A newer request, or a newer open, decides instead.
  if (found === null || mine !== focusRequests || opening !== openings) return;
  // Search results would hide a conversation outside them: the request is for this one, so leave the search.
  query.value = "";
  chosenKey.value = conversationKey(found);
  chosenSeen.value = found;
  readerShown.value = true;
}
// By key: a reload replaces every object, and must not clear a refusal about the row still selected.
const selectedKey = computed(() => (selected.value ? conversationKey(selected.value) : null));
watch(selectedKey, () => (notice.value = null));

/** One line under the reader: a failed save first, then a refused resume, then unreadable marks. */
const readerNotice = computed((): string | null => {
  if (selected.value !== null && saveFailedFor.value === selected.value.id) return t("libraryView.saveFailed");
  return notice.value ?? (marksFailed.value ? t("libraryView.marksUnreadable") : null);
});

const RESUME_REFUSALS: Record<Exclude<LibraryResume["kind"], "open">, string> = {
  busy: "libraryView.resumeBusy",
  "no-cwd": "libraryView.resumeNoCwd",
  unchecked: "libraryView.resumeUnchecked",
};

/** One promote at a time: a second press while the first is starting would open two sessions. */
let promoting = false;
async function promoteSelected(target: PromoteTarget): Promise<void> {
  const conversation = selected.value;
  if (conversation === null || promoting) return;
  promoting = true;
  const key = conversationKey(conversation);
  try {
    const refused = await startPromote(conversation, target);
    if (refused !== null && selectedKey.value === key) notice.value = t(refused);
  } finally {
    promoting = false;
  }
}

function pinSelected(pin: boolean): void {
  const conversation = selected.value;
  if (conversation === null) return;
  // Acting on the row shown by default makes it the chosen one, so the reader stays on it after it
  // moves in or out of the list.
  chosenKey.value = conversationKey(conversation);
  chosenSeen.value = conversation;
  void changeMark(conversation.id, { pinned: pin }, conversation);
}
function renameConversation(id: string, name: string | null): void {
  void changeMark(id, { name });
}

/** A memory's source, opened from the memory reader: the conversations, on that one. */
function openFromMemory(conversation: LibraryConversation): void {
  // A search typed for memory would hide the conversation among its results: leave it, as a request does.
  query.value = "";
  kind.value = "conversations";
  select(conversation);
}

function select(conversation: LibraryConversation): void {
  focusRequests += 1; // the user's own pick outranks a request still loading
  chosenKey.value = conversationKey(conversation);
  chosenSeen.value = conversation;
  readerShown.value = true;
}

/** Where the selected row last stood in the list, so the arrows go on from there if it leaves it. */
let lastIndex: number | null = null;
watch(
  () => (selected.value ? shown.value.indexOf(selected.value) : -1),
  (index) => {
    if (index >= 0) lastIndex = index;
  },
  { immediate: true },
);

async function move(by: number): Promise<void> {
  focusRequests += 1;
  const index = selected.value ? shown.value.indexOf(selected.value) : -1;
  const target = index < 0 && lastIndex !== null ? movedFromGap(lastIndex, by, shown.value.length) : movedIndex(index, by, shown.value.length);
  const next = shown.value[target];
  chosenKey.value = next === undefined ? null : conversationKey(next);
  chosenSeen.value = next ?? null;
  // The keys move the highlight, not the scroll: bring the row Enter will act on into view.
  await nextTick();
  document.querySelector("[data-library-row][aria-current=true]")?.scrollIntoView?.({ block: "nearest" });
}

/** One resume at a time: a second Enter while the first is still checking would open it twice. */
let resuming = false;
async function resume(): Promise<void> {
  const conversation = selected.value;
  // While a search is pending the list still shows the last query's results, and the row Enter would
  // act on is not one the reader has seen match what they typed.
  if (conversation === null || resuming || searching.value) return;
  resuming = true;
  try {
    await resumeConversation(conversation);
  } finally {
    resuming = false;
  }
}

async function resumeConversation(conversation: LibraryConversation): Promise<void> {
  const opening = openings;
  const key = conversationKey(conversation);
  const list = conversation.cwd === null ? null : await readResumableList(conversation.cwd, "claude");
  // Closed (and maybe reopened), or moved to another conversation, while this checked: it stands down.
  if (opening !== openings || selectedKey.value !== key) return;
  const decision = libraryResume(conversation, list, paletteTerminals.value?.openSessionIds() ?? []);
  if (decision.kind !== "open") {
    notice.value = t(RESUME_REFUSALS[decision.kind]);
    return;
  }
  openCellAt(cellForPanelResume({ id: decision.id, cwd: decision.cwd, agent: "claude", account: decision.account }), null);
}

const OTHER_CONTROLS = "button, a[href], summary, [role=button], [role=link], [contenteditable=true]";

function onKey(event: KeyboardEvent): void {
  if (!isOpen.value) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const inSearch = target !== null && searchField.value?.isSameNode(target) === true;
  const editable = target !== null && isEditableTarget(target.tagName, [...target.classList]);
  const modified = event.metaKey || event.ctrlKey || event.altKey;
  const onOtherControl = target?.closest(OTHER_CONTROLS) != null && target.closest("[data-library-row]") === null;
  const action = libraryKeyAction({
    key: event.key,
    inSearch,
    inOtherField: editable && !inSearch,
    onOtherControl,
    composing: isImeConfirming(event),
    modified,
  });
  // In Memory, Enter on a focused row is the row's own (it presses); elsewhere it edits.
  const onMemoryRow = target?.closest("[data-memory-row]") != null;
  // Tools and Storage have no primary action: Enter stays the focused control's own.
  if (action === null || (action === "primary" && ((kind.value === "memory" && onMemoryRow) || kind.value === "tools" || kind.value === "storage"))) return;
  event.preventDefault();
  runKeyAction(action);
}

function runKeyAction(action: NonNullable<ReturnType<typeof libraryKeyAction>>): void {
  const by = action === "up" ? -1 : 1;
  if (action === "focus-search") searchField.value?.focus();
  else if (kind.value === "storage") {
    if (action !== "primary") void storageView.value?.move(by);
  } else if (kind.value === "memory") {
    if (action === "primary") memoryView.value?.startEdit();
    else void memoryView.value?.move(by);
  } else if (kind.value === "tools") {
    void toolsView.value?.move(by);
  } else if (action === "primary") void resume();
  else void move(by);
}
window.addEventListener("keydown", onKey);
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  runClock(false);
});
</script>

<template>
  <FullScreenOverlay v-if="isOpen" :region-label="t('libraryView.region')" :close-label="t('libraryView.close')" @close="close">
    <template #header>
      <span class="font-sans text-[14px] font-[650] text-fg">{{ t("libraryView.title") }}</span>
      <span class="hidden font-sans text-[12px] text-dim sm:inline">{{ t(SHORTCUTS[kind]) }}</span>
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
            :placeholder="searchLabel"
            :aria-label="searchLabel"
            class="min-w-0 flex-1 border-0 bg-transparent font-sans text-[14px] text-fg outline-none"
          />
          <kbd class="rounded border border-border px-1 font-sans text-[11px] text-dim">/</kbd>
        </label>
        <div class="mt-2 flex items-center gap-3 font-sans text-[13px]" role="group" :aria-label="t('libraryView.kinds.label')">
          <button
            type="button"
            data-testid="library-kind-conversations"
            class="cursor-pointer rounded border-0 px-2 py-1"
            :class="kind === 'conversations' ? 'bg-hover text-fg' : 'bg-transparent text-secondary hover:text-fg'"
            :aria-pressed="kind === 'conversations'"
            @click="kind = 'conversations'"
          >
            {{ t("libraryView.kinds.conversations") }}
            <span class="text-dim">{{ hits ? hits.length : conversations.length }}{{ hasMore && !hits ? "+" : "" }}</span>
          </button>
          <button
            type="button"
            data-testid="library-kind-memory"
            class="cursor-pointer rounded border-0 px-2 py-1"
            :class="kind === 'memory' ? 'bg-hover text-fg' : 'bg-transparent text-secondary hover:text-fg'"
            :aria-pressed="kind === 'memory'"
            @click="kind = 'memory'"
          >
            {{ t("libraryView.memory.kind") }}
            <span class="text-dim">{{ memoryCount }}</span>
          </button>
          <button
            type="button"
            data-testid="library-kind-tools"
            class="cursor-pointer rounded border-0 px-2 py-1"
            :class="kind === 'tools' ? 'bg-hover text-fg' : 'bg-transparent text-secondary hover:text-fg'"
            :aria-pressed="kind === 'tools'"
            @click="kind = 'tools'"
          >
            {{ t("libraryView.tools.kind") }}
          </button>
          <button
            type="button"
            data-testid="library-kind-storage"
            class="cursor-pointer rounded border-0 px-2 py-1"
            :class="kind === 'storage' ? 'bg-hover text-fg' : 'bg-transparent text-secondary hover:text-fg'"
            :aria-pressed="kind === 'storage'"
            @click="kind = 'storage'"
          >
            {{ t("libraryView.storage.kind") }}
          </button>
          <span v-if="progress" class="text-dim" role="status" data-testid="library-progress">{{ progress }}</span>
          <span v-else-if="searching" class="text-dim">{{ t("libraryView.searching") }}</span>
        </div>
      </div>

      <LibraryTools v-if="kind === 'tools'" ref="toolsView" :query="query" :initial-cwd="selected?.cwd ?? null" />
      <LibraryStorage
        v-else-if="kind === 'storage'"
        ref="storageView"
        :answer="storage.answer.value"
        :loaded="storage.loaded.value"
        :failed="storage.failed.value"
        :start-refused="storage.startRefused.value"
        :now="now"
        @remeasure="storage.remeasure"
      />
      <LibraryMemory
        v-else-if="kind === 'memory'"
        ref="memoryView"
        :projects="memoryProjects"
        :loaded="memoryLoaded"
        :failed="memoryFailed"
        :query="query"
        :now="now"
        :health="memoryHealth"
        :health-failed="memoryHealthFailed"
        @changed="refreshMemory"
        @open-conversation="openFromMemory"
      />
      <p v-else-if="loadFailed" class="m-0 px-4 py-6 font-sans text-[13px] text-err-text">{{ t("libraryView.loadFailed") }}</p>
      <p v-else-if="!loaded" class="m-0 px-4 py-6 font-sans text-[13px] text-dim">{{ t("libraryView.loading") }}</p>
      <p v-else-if="searchFailed && !searching" class="m-0 px-4 py-6 font-sans text-[13px] text-err-text" data-testid="library-search-failed">
        {{ t("libraryView.searchFailed") }}
      </p>
      <p v-else-if="hits && !hits.length && !searching" class="m-0 px-4 py-6 font-sans text-[13px] text-dim" data-testid="library-no-match">
        {{ t("libraryView.noMatch", { query: query.trim() }) }}
      </p>
      <div
        v-else-if="!hits && !conversations.length && !pinned.length && selected === null"
        class="px-4 py-6 font-sans text-[13px] text-dim"
        data-testid="library-empty"
      >
        <p class="m-0">{{ t("libraryView.empty") }}</p>
        <!-- The reader carries this notice otherwise; with nothing listed there is no reader. -->
        <p v-if="marksFailed" class="m-0 mt-2 text-err-text" role="status">{{ t("libraryView.marksUnreadable") }}</p>
      </div>

      <div v-else class="flex min-h-0 flex-1 border-t border-border">
        <div
          class="flex min-h-0 w-[360px] flex-none flex-col border-r border-border max-[760px]:w-full max-[760px]:border-r-0"
          :class="readerShown ? 'max-[760px]:hidden' : ''"
        >
          <LibraryList
            :conversations="conversations"
            :hits="hits"
            :selected-key="selected ? conversationKey(selected) : null"
            :now="now"
            :has-more="hasMore"
            :pinned="pinned"
            :pinned-ids="marks.pinned"
            :names="marks.names"
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
          <LibraryReader
            v-if="selected"
            :conversation="selected"
            :now="now"
            :notice="readerNotice"
            :name="marks.names[selected.id] ?? null"
            :pinned="marks.pinned.includes(selected.id)"
            @resume="resume"
            @pin="pinSelected"
            @rename="renameConversation"
            @promote="promoteSelected"
          />
          <p v-else class="m-0 p-6 font-sans text-[13px] text-dim">{{ t("libraryView.pick") }}</p>
        </div>
      </div>
    </div>
  </FullScreenOverlay>
</template>
