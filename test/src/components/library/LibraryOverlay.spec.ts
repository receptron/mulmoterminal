// The Library screen (#3329), mounted with its reads stubbed: the list and the reader, search and its
// empty answer, the keys, and what Enter resumes — or why it will not.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { LibraryConversation, LibraryIndexStatus, LibrarySearchHit } from "../../../../common/library";
import type { ResumableList } from "../../../../src/composables/useDirLists";

const libraryOpen = ref(true);
vi.mock("../../../../src/composables/useLibraryView", () => ({ useLibraryView: () => ({ isOpen: libraryOpen, close: vi.fn() }) }));

let page: LibraryConversation[] = [];
let status: LibraryIndexStatus | null = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 1 };
let hits: LibrarySearchHit[] = [];
let statusGate: Promise<void> = Promise.resolve();
let more: { conversations: LibraryConversation[]; hasMore: boolean } | null = null;
let firstHasMore = false;
vi.mock("../../../../src/composables/libraryApi", () => ({
  LIBRARY_PAGE: 50,
  loadLibraryPage: (offset: number) => Promise.resolve(offset === 0 ? { conversations: page, hasMore: firstHasMore } : more),
  loadLibraryStatus: async () => {
    await statusGate;
    return status;
  },
  searchLibrary: () => Promise.resolve(hits),
}));

const opened: unknown[] = [];
vi.mock("../../../../src/composables/useNewTerminal", () => ({ openCellAt: (cell: unknown) => opened.push(cell) }));

let resumableList: ResumableList = { sessions: [], cwd: null };
let loadGate: Promise<void> = Promise.resolve();
let listUnreadable = false;
vi.mock("../../../../src/composables/useDirLists", () => ({
  readResumableList: async () => {
    await loadGate;
    return listUnreadable ? null : resumableList;
  },
}));

const openIds: string[] = [];
vi.mock("../../../../src/composables/commandPalette", () => ({ paletteTerminals: { value: { openSessionIds: () => openIds } } }));

const LibraryOverlay = (await import("../../../../src/components/library/LibraryOverlay.vue")).default;
const { LIBRARY_STATUS_POLL_MS } = await import("../../../../src/composables/useLibraryData");

const NOW = Date.now();
const conversation = (id: string, title: string, over: Partial<LibraryConversation> = {}): LibraryConversation => ({
  ...{ id, agent: "claude", title, cwd: "/Users/me/work/clip-studio", gitBranch: "main", prs: [], costUsd: 0.84, linesAdded: 146, linesRemoved: 12 },
  ...{ startedAt: NOW, endedAt: NOW, skills: [], hookErrors: 0, userTurns: 1, isSidechain: false, parentId: null, isTemporary: false, entrypoint: "cli" },
  ...over,
});

async function mountLibrary() {
  const wrapper = mount(LibraryOverlay, {
    attachTo: document.body,
    global: {
      stubs: {
        TranscriptPane: { template: "<div data-testid='transcript-stub' />" },
        FullScreenOverlay: { template: "<div><slot name='header' /><slot /></div>" },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

const press = async (key: string) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  await flushPromises();
};

beforeEach(() => {
  libraryOpen.value = true;
  page = [conversation("a", "Burn subtitles"), conversation("b", "CI under ten minutes", { endedAt: NOW - 30 * 24 * 3_600_000 })];
  status = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 1 };
  hits = [];
  opened.length = 0;
  openIds.length = 0;
  resumableList = { sessions: [], cwd: null };
  loadGate = Promise.resolve();
  statusGate = Promise.resolve();
  listUnreadable = false;
  more = null;
  firstHasMore = false;
});

describe("LibraryOverlay", () => {
  it("lists the conversations by day and reads the first one", async () => {
    const wrapper = await mountLibrary();
    const rows = wrapper.findAll("[data-testid=library-row]");
    expect(rows.map((row) => row.text())).toEqual([expect.stringContaining("Burn subtitles"), expect.stringContaining("CI under ten minutes")]);
    expect(rows[0]?.text()).toContain("clip-studio · main");
    expect(wrapper.find("[data-testid=library-reader]").text()).toContain("Burn subtitles");
    expect(wrapper.find("[data-testid=library-reader]").text()).toContain("$0.84");
  });

  it("moves through the rows with the arrow keys", async () => {
    const wrapper = await mountLibrary();
    await press("ArrowDown");
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toBe("CI under ten minutes");
    await press("ArrowDown");
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toBe("CI under ten minutes");
    await press("ArrowUp");
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toBe("Burn subtitles");
  });

  it("shows the matching turn for a search, and one sentence when nothing matches", async () => {
    const wrapper = await mountLibrary();
    hits = [{ conversation: page[1] ?? conversation("x", "x"), snippet: "…split the jobs…", role: "assistant" }];
    await wrapper.find("[data-testid=library-search]").setValue("split");
    await new Promise((resolve) => setTimeout(resolve, 260));
    await flushPromises();
    expect(wrapper.findAll("[data-testid=library-row]").map((row) => row.text())).toEqual([expect.stringContaining("…split the jobs…")]);
    hits = [];
    await wrapper.find("[data-testid=library-search]").setValue("nothing here");
    await new Promise((resolve) => setTimeout(resolve, 260));
    await flushPromises();
    expect(wrapper.find("[data-testid=library-no-match]").text()).toContain("nothing here");
  });

  it("resumes the selected conversation where it ran on Enter", async () => {
    await mountLibrary();
    await press("Enter");
    expect(opened).toEqual([{ session: "a", cwd: "/Users/me/work/clip-studio" }]);
  });

  it("says so instead of resuming a conversation that is already open", async () => {
    openIds.push("a");
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-resume]").trigger("click");
    await flushPromises();
    expect(opened).toEqual([]);
    expect(wrapper.find("[role=status]").exists()).toBe(true);
  });

  it("shows how far the index has got during the first build only", async () => {
    status = { indexing: true, filesDone: 40, filesTotal: 100, finishedAt: null };
    const wrapper = await mountLibrary();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushPromises();
    expect(wrapper.find("[data-testid=library-progress]").text()).toContain("40");
    wrapper.unmount();
    status = { indexing: true, filesDone: 40, filesTotal: 100, finishedAt: 1 }; // a catch-up pass
    const later = await mountLibrary();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushPromises();
    expect(later.find("[data-testid=library-progress]").exists()).toBe(false);
  });

  it("starts with the cursor in the search field", async () => {
    const wrapper = await mountLibrary();
    expect(document.activeElement).toBe(wrapper.find("[data-testid=library-search]").element);
  });

  it("resumes once, however often Enter is pressed while it checks", async () => {
    let release: () => void = () => {};
    loadGate = new Promise((resolve) => (release = resolve));
    await mountLibrary();
    await press("Enter");
    await press("Enter");
    release();
    await flushPromises();
    expect(opened).toHaveLength(1);
  });

  it("keeps the way to the next page when reading it failed", async () => {
    firstHasMore = true;
    more = null;
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=library-more]").exists()).toBe(true);
  });

  it("fills the list when the first build finishes", async () => {
    page = [];
    status = { indexing: true, filesDone: 1, filesTotal: 9, finishedAt: null };
    const wrapper = await mountLibrary();
    await new Promise((resolve) => setTimeout(resolve, 10));
    page = [conversation("late", "Indexed at last")];
    status = { indexing: false, filesDone: 9, filesTotal: 9, finishedAt: 5 };
    await new Promise((resolve) => setTimeout(resolve, LIBRARY_STATUS_POLL_MS + 200));
    await flushPromises();
    expect(wrapper.findAll("[data-testid=library-row]").map((row) => row.text())).toEqual([expect.stringContaining("Indexed at last")]);
  }, 10_000);

  it("does not resume when it cannot check who holds the conversation", async () => {
    listUnreadable = true;
    const wrapper = await mountLibrary();
    await press("Enter");
    expect(opened).toEqual([]);
    expect(wrapper.find("[role=status]").text().length).toBeGreaterThan(0);
  });

  it("keeps one polling loop through a close and reopen, and keeps asking after a failed read", async () => {
    const { useLibraryData } = await import("../../../../src/composables/useLibraryData");
    const api = await import("../../../../src/composables/libraryApi");
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
    host.unmount();
  }, 10_000);

  it("drops a search still pending when the screen closes", async () => {
    const { useLibraryData } = await import("../../../../src/composables/useLibraryData");
    hits = [{ conversation: conversation("stale", "Stale"), snippet: "stale", role: "user" }];
    const open = ref(true);
    let data: ReturnType<typeof useLibraryData> | null = null;
    const host = mount({ setup: () => (data = useLibraryData(open)), template: "<div />" });
    await flushPromises();
    if (data === null) throw new Error("not mounted");
    const state: ReturnType<typeof useLibraryData> = data;
    state.query.value = "stale";
    await flushPromises();
    open.value = false;
    await flushPromises();
    open.value = true;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();
    expect(state.query.value).toBe("");
    expect(state.hits.value).toBeNull();
    host.unmount();
  });

  it("leaves Enter to a button inside the conversation", async () => {
    const wrapper = await mountLibrary();
    const control = document.createElement("button");
    wrapper.find("[data-testid=library-reader]").element.appendChild(control);
    control.focus();
    control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(opened).toEqual([]);
  });

  it("says the search failed rather than that nothing matched", async () => {
    const api = await import("../../../../src/composables/libraryApi");
    vi.spyOn(api, "searchLibrary").mockResolvedValueOnce(null);
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-search]").setValue("anything");
    await new Promise((resolve) => setTimeout(resolve, 260));
    await flushPromises();
    expect(wrapper.find("[data-testid=library-search-failed]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=library-no-match]").exists()).toBe(false);
  });

  it("keeps reading the chosen conversation when the list is reloaded", async () => {
    status = { indexing: true, filesDone: 1, filesTotal: 2, finishedAt: 1 }; // a catch-up pass under way
    const wrapper = await mountLibrary();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await press("ArrowDown");
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toBe("CI under ten minutes");
    // The pass ends: the list is read again, and every conversation arrives as a new object.
    page = page.map((c) => ({ ...c }));
    status = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 2 };
    await new Promise((resolve) => setTimeout(resolve, LIBRARY_STATUS_POLL_MS + 200));
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toBe("CI under ten minutes");
  }, 10_000);

  it("drops a resume still checking when the screen closes", async () => {
    let release: () => void = () => {};
    loadGate = new Promise((resolve) => (release = resolve));
    await mountLibrary();
    await press("Enter");
    libraryOpen.value = false;
    await flushPromises();
    libraryOpen.value = true;
    await flushPromises();
    release();
    await flushPromises();
    expect(opened).toEqual([]);
  });

  it("reads the list again when the build had already finished by the first progress answer", async () => {
    page = [];
    let release: () => void = () => {};
    statusGate = new Promise((resolve) => (release = resolve));
    status = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 5 };
    const wrapper = await mountLibrary(); // the page read answers empty; the status read is held
    page = [conversation("built", "Built meanwhile")];
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushPromises();
    expect(wrapper.findAll("[data-testid=library-row]").map((row) => row.text())).toEqual([expect.stringContaining("Built meanwhile")]);
  });

  it("does not resume while a newer search is still pending", async () => {
    const wrapper = await mountLibrary();
    hits = [{ conversation: page[1] ?? conversation("x", "x"), snippet: "alpha", role: "user" }];
    await wrapper.find("[data-testid=library-search]").setValue("alpha");
    await new Promise((resolve) => setTimeout(resolve, 260));
    await flushPromises();
    await wrapper.find("[data-testid=library-search]").setValue("beta"); // its answer has not come yet
    await press("Enter");
    expect(opened).toEqual([]);
  });
});
