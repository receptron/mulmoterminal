// What the Library screen shows (#3329): the newest conversations a page at a time, the search
// results for what is typed, and how far the index has got. Read while the screen is open only.
import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";
import type { LibraryConversation, LibraryIndexStatus, LibrarySearchHit } from "../../common/library";
import { loadLibraryPage, loadLibraryStatus, searchLibrary } from "./libraryApi";

/** Typing pauses this long before a search is sent, so each keystroke does not start one. */
export const LIBRARY_SEARCH_DEBOUNCE_MS = 200;
/** How often progress is asked for while the index is being built. */
export const LIBRARY_STATUS_POLL_MS = 2_000;

export function useLibraryData(isOpen: Ref<boolean>) {
  const conversations = shallowRef<LibraryConversation[]>([]);
  const hasMore = ref(false);
  const loaded = ref(false);
  const loadFailed = ref(false);
  const status = shallowRef<LibraryIndexStatus | null>(null);
  const query = ref("");
  /** Null while nothing is typed; the list shows instead. */
  const hits = shallowRef<LibrarySearchHit[] | null>(null);
  const searching = ref(false);
  let pageRequest = 0;

  async function reload(): Promise<void> {
    const mine = ++pageRequest;
    const page = await loadLibraryPage(0);
    if (mine !== pageRequest) return;
    loaded.value = true;
    loadFailed.value = page === null;
    conversations.value = page?.conversations ?? [];
    hasMore.value = page?.hasMore ?? false;
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value) return;
    const mine = ++pageRequest;
    hasMore.value = false; // one request at a time; restored by its answer
    const page = await loadLibraryPage(conversations.value.length);
    if (mine !== pageRequest) return;
    if (page === null) {
      hasMore.value = true; // the page is still there; a failed read must not take the way to it
      return;
    }
    conversations.value = [...conversations.value, ...page.conversations];
    hasMore.value = page.hasMore;
  }

  const poll = usePolledStatus(status, () => void reload());
  const search = useDebouncedSearch(query, hits, searching);

  watch(
    isOpen,
    (open) => {
      poll.stop();
      if (!open) return;
      void reload();
      poll.start();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    poll.stop();
    search.cancel();
  });

  return { conversations, hasMore, loaded, loadFailed, status, query, hits, searching, loadMore, reload };
}

/** Polls progress while the index is being built, and reloads the list when a pass finishes. */
function usePolledStatus(status: Ref<LibraryIndexStatus | null>, onFinished: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The last pass end this screen saw; undefined until the first answer, which only sets it. */
  let seenFinish: number | null | undefined;
  // Each start is a new generation: a request from before a close and reopen must not schedule a
  // second loop beside the new one.
  let generation = 0;
  async function tick(mine: number): Promise<void> {
    const next = await loadLibraryStatus();
    if (mine !== generation) return; // stopped, or restarted, while asking
    status.value = next;
    const finished = next?.finishedAt ?? null;
    // A pass that ended since the last answer — the first build included, whose list was empty.
    if (seenFinish !== undefined && finished !== null && finished !== seenFinish) onFinished();
    if (next !== null) seenFinish = finished;
    // A failed read is asked again: during the first build it is the only way the list fills.
    timer = next === null || next.indexing ? setTimeout(() => void tick(mine), LIBRARY_STATUS_POLL_MS) : null;
  }
  return {
    start: () => {
      seenFinish = undefined;
      const mine = ++generation;
      timer = setTimeout(() => void tick(mine), 0);
    },
    stop: () => {
      generation++;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Sends what is typed after a pause, and drops an answer the next keystroke made stale. */
function useDebouncedSearch(query: Ref<string>, hits: Ref<LibrarySearchHit[] | null>, searching: Ref<boolean>) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    inFlight?.abort();
    timer = null;
    inFlight = null;
  };
  watch(query, (typed) => {
    cancel();
    const text = typed.trim();
    if (text === "") {
      hits.value = null;
      searching.value = false;
      return;
    }
    searching.value = true;
    timer = setTimeout(() => void run(text), LIBRARY_SEARCH_DEBOUNCE_MS);
  });
  async function run(text: string): Promise<void> {
    const controller = new AbortController();
    inFlight = controller;
    const found = await searchLibrary(text, controller.signal);
    if (controller.signal.aborted) return;
    hits.value = found ?? [];
    searching.value = false;
  }
  return { cancel };
}
