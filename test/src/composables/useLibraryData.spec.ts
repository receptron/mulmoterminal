// The Library's data composable on its own (#3329): the progress poll and the search and paging
// state under close, reopen and stale answers — without the screen around it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { LibraryConversation, LibraryIndexStatus, LibrarySearchHit } from "../../../common/library";

let status: LibraryIndexStatus | null = null;
let statusGate: Promise<void> = Promise.resolve();
let hits: LibrarySearchHit[] = [];
let firstHasMore = false;
vi.mock("../../../src/composables/libraryApi", () => ({
  LIBRARY_PAGE: 50,
  loadLibraryPage: (offset: number) => Promise.resolve(offset === 0 ? { conversations: page, hasMore: firstHasMore, indexFinishedAt: 1 } : null),
  loadLibraryStatus: async () => {
    await statusGate;
    return status;
  },
  searchLibrary: () => Promise.resolve(hits),
}));

const { LIBRARY_STATUS_POLL_MS } = await import("../../../src/composables/useLibraryData");

const NOW = Date.now();
const conversation = (id: string, title: string): LibraryConversation => ({
  ...{ id, agent: "claude", title, cwd: "/w", gitBranch: "main", prs: [], costUsd: null, linesAdded: null, linesRemoved: null },
  ...{ startedAt: NOW, endedAt: NOW, skills: [], hookErrors: 0, userTurns: 1, isSidechain: false, parentId: null, isTemporary: false, entrypoint: "cli" },
});
let page: LibraryConversation[] = [];

beforeEach(() => {
  page = [conversation("a", "A"), conversation("b", "B")];
  status = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 1 };
  statusGate = Promise.resolve();
  hits = [];
  firstHasMore = false;
});

describe("useLibraryData", () => {
  it("keeps one polling loop through a close and reopen, and keeps asking after a failed read", async () => {
    const { useLibraryData } = await import("../../../src/composables/useLibraryData");
    const api = await import("../../../src/composables/libraryApi");
    const calls = vi.spyOn(api, "loadLibraryStatus");
    status = null; // the read fails: the poll must keep going
    let release: () => void = () => {};
    statusGate = new Promise((resolve) => (release = resolve));
    const open = ref(true);
    const host = mount({ setup: () => useLibraryData(open), template: "<div />" });
    await new Promise((resolve) => setTimeout(resolve, 5)); // the first read is now waiting
    open.value = false;
    await flushPromises();
    open.value = true;
    await new Promise((resolve) => setTimeout(resolve, 5)); // and so is the reopened screen's
    release();
    await flushPromises();
    calls.mockClear();
    await new Promise((resolve) => setTimeout(resolve, LIBRARY_STATUS_POLL_MS + 300));
    expect(calls).toHaveBeenCalledTimes(1);
    calls.mockRestore();
    host.unmount();
  }, 10_000);

  // The screen is kept while closed: what was typed, and what it found, are there on the next open.
  it("keeps the query and its results across a close", async () => {
    const { useLibraryData } = await import("../../../src/composables/useLibraryData");
    hits = [{ conversation: conversation("kept", "Kept"), snippet: "kept", role: "user" }];
    const open = ref(true);
    let data: ReturnType<typeof useLibraryData> | null = null;
    const host = mount({ setup: () => (data = useLibraryData(open)), template: "<div />" });
    await flushPromises();
    if (data === null) throw new Error("not mounted");
    const state: ReturnType<typeof useLibraryData> = data;
    state.query.value = "kept";
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();
    open.value = false;
    await flushPromises();
    expect(state.query.value).toBe("kept");
    expect(state.hits.value?.map((hit) => hit.conversation.id)).toEqual(["kept"]);
    open.value = true;
    await flushPromises();
    expect(state.query.value).toBe("kept");
    expect(state.hits.value?.map((hit) => hit.conversation.id)).toEqual(["kept"]);
    host.unmount();
  });

  it("holds Show more while the list is being read again", async () => {
    const { useLibraryData } = await import("../../../src/composables/useLibraryData");
    const api = await import("../../../src/composables/libraryApi");
    firstHasMore = true;
    const open = ref(true);
    let data: ReturnType<typeof useLibraryData> | null = null;
    const host = mount({ setup: () => (data = useLibraryData(open)), template: "<div />" });
    await flushPromises();
    if (data === null) throw new Error("not mounted");
    const state: ReturnType<typeof useLibraryData> = data;
    const reads = vi.spyOn(api, "loadLibraryPage");
    const reloading = state.reload();
    await state.loadMore(); // while the reload is still waiting for its page
    await reloading;
    // Only first pages were read: no page counted from the old list's length was asked for meanwhile.
    expect(reads.mock.calls.length).toBeGreaterThan(0);
    expect(reads.mock.calls.every((call) => call[0] === 0)).toBe(true);
    reads.mockRestore();
    host.unmount();
  });

  it("keeps one polling loop when a stale answer lands after a reopen", async () => {
    const { usePolledStatus } = await import("../../../src/composables/useLibraryData");
    const api = await import("../../../src/composables/libraryApi");
    status = { indexing: true, filesDone: 1, filesTotal: 9, finishedAt: null };
    const poll = usePolledStatus(
      ref(null),
      () => null,
      () => {},
      () => false,
    );
    let releaseOld: () => void = () => {};
    statusGate = new Promise((resolve) => (releaseOld = resolve));
    poll.start();
    await new Promise((resolve) => setTimeout(resolve, 5)); // the first tick waits for its answer
    poll.stop();
    statusGate = new Promise(() => {}); // the reopened screen's answer never comes in this test
    poll.start();
    await new Promise((resolve) => setTimeout(resolve, 5)); // its tick is waiting too
    releaseOld(); // the stale answer lands
    await flushPromises();
    const asks = vi.spyOn(api, "loadLibraryStatus");
    asks.mockClear(); // a spy left by another test keeps its history
    poll.wake(); // a read lands while the current tick still waits: it must not start a second loop
    await new Promise((resolve) => setTimeout(resolve, LIBRARY_STATUS_POLL_MS + 300));
    expect(asks).not.toHaveBeenCalled();
    asks.mockRestore();
    poll.stop();
  }, 10_000);
});
