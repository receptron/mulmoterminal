// What the Library screen shows (#3329): the newest conversations a page at a time, the search
// results for what is typed, and how far the index has got. Read while the screen is open only; kept
// while it is closed.
import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";
import type { LibraryConversation, LibraryIndexStatus, LibrarySearchHit } from "../../common/library";
import { loadLibraryPage, loadLibraryStatus, searchLibrary } from "./libraryApi";

/** Typing pauses this long before a search is sent, so each keystroke does not start one. */
export const LIBRARY_SEARCH_DEBOUNCE_MS = 200;
/** How often progress is asked for while the index is being built. */
export const LIBRARY_STATUS_POLL_MS = 2_000;

export function useLibraryData(isOpen: Ref<boolean>) {
  const { conversations, hasMore, loaded, loadFailed, reflects, reload, loadMore } = usePagedConversations();
  const status = shallowRef<LibraryIndexStatus | null>(null);
  const query = ref("");
  /** Null while nothing is typed; the list shows instead. */
  const hits = shallowRef<LibrarySearchHit[] | null>(null);
  const searching = ref(false);
  /** The last search could not be answered — not the same as "nothing matches". */
  const searchFailed = ref(false);

  const poll = usePolledStatus(
    status,
    () => reflects.value,
    () => {
      void reload();
      search.refresh(); // a search that found nothing mid-build may find it now
    },
    () => loadFailed.value,
  );
  const search = useDebouncedSearch(query, hits, searching, searchFailed);
  // A list read can fail after the poll has already gone quiet (the index idle): wake it to retry.
  watch(loadFailed, (failed) => {
    if (failed) poll.wake();
  });
  // Any read can start a pass on the server (the index catches up when asked), so every answer wakes
  // the poll; one that finds the index idle and the list current goes quiet again.
  watch([conversations, hits], () => poll.wake());

  watch(
    isOpen,
    (open) => {
      poll.stop();
      // The query and its results stay for the next opening; both are read again then.
      if (!open) return search.cancel();
      void reload();
      search.refresh();
      poll.start();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    poll.stop();
    search.cancel();
  });

  return { conversations, hasMore, loaded, loadFailed, status, query, hits, searching, searchFailed, loadMore, reload };
}

/** The newest conversations, a page at a time; a newer read always wins over an older one. */
function usePagedConversations() {
  const conversations = shallowRef<LibraryConversation[]>([]);
  const hasMore = ref(false);
  const loaded = ref(false);
  const loadFailed = ref(false);
  /** The finished index pass the list shows; undefined before the first page arrives. */
  const reflects = ref<number | null | undefined>(undefined);
  let pageRequest = 0;

  /** Reloads in flight. "Show more" waits for them: a page counted from the old list's length would
   *  repeat or skip rows once the reload replaces it. */
  let reloading = 0;
  /** A page was read at least once: a failed re-read keeps it on screen instead of an error. */
  let listed = false;
  /** Whether more pages followed, as the last answer said: a "Show more" still out has cleared it. */
  let settledHasMore = false;
  async function reload(): Promise<void> {
    const mine = ++pageRequest;
    reloading++;
    const page = await loadLibraryPage(0).finally(() => reloading--);
    if (mine !== pageRequest) return;
    loaded.value = true;
    // A failed read reflects no pass, so the next status answer reads the list again.
    reflects.value = page === null ? undefined : page.indexFinishedAt;
    loadFailed.value = page === null && !listed;
    if (page === null) {
      hasMore.value = settledHasMore;
      return;
    }
    listed = true;
    conversations.value = page.conversations;
    hasMore.value = settledHasMore = page.hasMore;
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value || reloading > 0) return;
    const mine = ++pageRequest;
    hasMore.value = false; // one request at a time; restored by its answer
    const page = await loadLibraryPage(conversations.value.length);
    if (mine !== pageRequest) return;
    if (page === null) {
      hasMore.value = true; // the page is still there; a failed read must not take the way to it
      return;
    }
    conversations.value = [...conversations.value, ...page.conversations];
    hasMore.value = settledHasMore = page.hasMore;
  }

  return { conversations, hasMore, loaded, loadFailed, reflects, reload, loadMore };
}

/** Polls progress while the index is being built, and reloads the list whenever a pass has finished
 *  that the list does not reflect — the first build, a list read part-way through it, a catch-up. */
export function usePolledStatus(
  status: Ref<LibraryIndexStatus | null>,
  listReflects: () => number | null | undefined,
  reloadList: () => void,
  listFailed: () => boolean,
) {
  /** The next tick, once it is scheduled and until it fires. */
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  /** The generation whose tick is waiting for its answer, or null. A wake then cannot schedule (the
   *  answer decides), so it is remembered and honoured when the answer comes. Kept per generation: a
   *  stale answer from before a close and reopen must not clear the current tick's flag. */
  let askingFor: number | null = null;
  let wakeAgain = false;
  let active = false;
  // Each start is a new generation: a request from before a close and reopen must not schedule a
  // second loop beside the new one.
  let generation = 0;
  const schedule = (mine: number, delay_ms: number): void => {
    scheduled = setTimeout(() => {
      scheduled = null;
      void tick(mine);
    }, delay_ms);
  };
  async function tick(mine: number): Promise<void> {
    askingFor = mine;
    wakeAgain = false;
    const next = await loadLibraryStatus();
    if (mine !== generation) return; // stopped, or restarted, while asking — touching nothing
    askingFor = null;
    status.value = next;
    const finished = next?.finishedAt ?? null;
    if ((finished !== null && finished !== listReflects()) || listFailed()) reloadList();
    // Kept going while the build runs, after a failed read of either kind, and when something woke the
    // poll while this answer was on its way.
    if (next === null || next.indexing || listFailed() || wakeAgain) schedule(mine, LIBRARY_STATUS_POLL_MS);
  }
  return {
    start: () => {
      active = true;
      schedule(++generation, 0);
    },
    stop: () => {
      active = false;
      wakeAgain = false;
      generation++;
      if (scheduled !== null) clearTimeout(scheduled);
      scheduled = null;
    },
    /** Makes sure a tick is coming: woken if quiet, remembered if a tick is waiting for its answer. */
    wake: () => {
      if (!active || scheduled !== null) return;
      if (askingFor === generation) wakeAgain = true;
      else schedule(generation, LIBRARY_STATUS_POLL_MS);
    },
  };
}

/** Sends what is typed after a pause, and drops an answer the next keystroke made stale. */
function useDebouncedSearch(query: Ref<string>, hits: Ref<LibrarySearchHit[] | null>, searching: Ref<boolean>, failed: Ref<boolean>) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  /** The query the shown hits answer, so a failed re-read of it can keep them. */
  let hitsFor: string | null = null;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    inFlight?.abort();
    timer = null;
    inFlight = null;
  };
  watch(query, (typed) => {
    cancel();
    failed.value = false;
    const text = typed.trim();
    if (text === "") {
      hits.value = null;
      hitsFor = null;
      searching.value = false;
      return;
    }
    searching.value = true;
    timer = setTimeout(() => {
      timer = null; // fired: no longer pending
      void run(text);
    }, LIBRARY_SEARCH_DEBOUNCE_MS);
  });
  /** Runs the current query again, for when the index under it has changed; nothing typed, nothing run. */
  function refresh(): void {
    const text = query.value.trim();
    if (text === "" || timer !== null) return; // a pending debounce will run it anyway
    inFlight?.abort();
    void run(text);
  }
  async function run(text: string): Promise<void> {
    searching.value = true; // a refresh runs without the keystroke that set it
    const controller = new AbortController();
    inFlight = controller;
    const found = await searchLibrary(text, controller.signal);
    if (controller.signal.aborted) return;
    searching.value = false;
    if (found === null && hitsFor === text) return;
    hits.value = found ?? [];
    hitsFor = found === null ? null : text;
    failed.value = found === null;
  }
  return { cancel, refresh };
}
