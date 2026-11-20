// The Library screen (#3329), mounted with its reads stubbed: the list and the reader, search and its
// empty answer, the keys, and what Enter resumes — or why it will not.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { LibraryMemoryProject } from "../../../../common/libraryMemory";
import type { LibraryConversation, LibraryIndexStatus, LibrarySearchHit } from "../../../../common/library";
import type { ResumableList } from "../../../../src/composables/useDirLists";

const libraryOpen = ref(true);
const closeLibrary = vi.fn();
let memoryProjects: LibraryMemoryProject[] = [];
let memoryTexts: Record<string, { text: string | null }> = {};
let requested: { session: string; cwd: string | null } | null = null;
vi.mock("../../../../src/composables/useLibraryView", () => ({
  useLibraryView: () => ({ isOpen: libraryOpen, close: closeLibrary }),
  libraryRequested: () => requested,
}));

let page: LibraryConversation[] = [];
let status: LibraryIndexStatus | null = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 1 };
let hits: LibrarySearchHit[] = [];
let statusGate: Promise<void> = Promise.resolve();
let marks: { pinned: string[]; names: Record<string, string> } = { pinned: [], names: {} };
let saveFails = false;
let saveGate: Promise<void> = Promise.resolve();
let marksGate: Promise<void> = Promise.resolve();
let marksUnreadable = false;
let more: { conversations: LibraryConversation[]; hasMore: boolean; indexFinishedAt: number | null } | null = null;
/** The finished pass the next first page says it reflects. */
let pageFinished: number | null = 1;
/** First pages that fail before one succeeds. */
let pageFailures = 0;
let firstHasMore = false;
vi.mock("../../../../src/composables/libraryApi", () => ({
  LIBRARY_PAGE: 50,
  // The reader's changed-files strip, which these specs do not look at.
  loadLibraryFiles: () => Promise.resolve([]),
  loadLibraryFileText: () => Promise.resolve(null),
  loadLibraryMemory: () => Promise.resolve(memoryProjects),
  loadLibraryMemoryFile: (slug: string, file: string) => Promise.resolve(memoryTexts[`${slug}/${file}`] ?? null),
  loadLibraryPage: (offset: number) => {
    if (offset === 0 && pageFailures > 0) {
      pageFailures--;
      return Promise.resolve(null);
    }
    return Promise.resolve(offset === 0 ? { conversations: page, hasMore: firstHasMore, indexFinishedAt: pageFinished } : more);
  },
  loadLibraryStatus: async () => {
    await statusGate;
    return status;
  },
  searchLibrary: () => Promise.resolve(hits),
  loadLibraryMarks: async () => {
    const answer = marksUnreadable ? null : { ...marks };
    await marksGate;
    return answer;
  },
  loadLibraryConversation: (id: string) => Promise.resolve(page.find((c) => c.id === id) ?? null),
  saveLibraryMark: async (id: string, change: { pinned?: boolean; name?: string | null }) => {
    // Applied and answered as of ARRIVAL, as the server does; only the delivery waits on the gate.
    const gate = saveGate;
    if (saveFails) {
      await gate; // a failure is delivered as late as a success would be
      return null;
    }
    if (change.pinned !== undefined)
      marks = { ...marks, pinned: change.pinned ? [id, ...marks.pinned.filter((p) => p !== id)] : marks.pinned.filter((p) => p !== id) };
    if (change.name !== undefined) marks = { ...marks, names: change.name ? { ...marks.names, [id]: change.name } : {} };
    const answer = { ...marks };
    await gate;
    return answer;
  },
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
  requested = null;
  memoryProjects = [];
  memoryTexts = {};
  closeLibrary.mockClear();
  marks = { pinned: [], names: {} };
  saveFails = false;
  saveGate = Promise.resolve();
  marksGate = Promise.resolve();
  marksUnreadable = false;
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
  pageFinished = 1;
  pageFailures = 0;
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
    pageFinished = null;
    status = { indexing: true, filesDone: 1, filesTotal: 9, finishedAt: null };
    const wrapper = await mountLibrary();
    await new Promise((resolve) => setTimeout(resolve, 10));
    page = [conversation("late", "Indexed at last")];
    pageFinished = 5;
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
    pageFinished = 2;
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
    pageFinished = null;
    let release: () => void = () => {};
    statusGate = new Promise((resolve) => (release = resolve));
    status = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 5 };
    const wrapper = await mountLibrary(); // the page read answers empty; the status read is held
    page = [conversation("built", "Built meanwhile")];
    pageFinished = 5;
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

  it("reads a list taken part-way through the first build again once it is done", async () => {
    page = [conversation("early", "Indexed early")];
    pageFinished = null; // read while the first build was still going
    let release: () => void = () => {};
    statusGate = new Promise((resolve) => (release = resolve));
    status = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 5 };
    const wrapper = await mountLibrary();
    page = [conversation("early", "Indexed early"), conversation("rest", "Indexed with the rest")];
    pageFinished = 5;
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushPromises();
    expect(wrapper.findAll("[data-testid=library-row]")).toHaveLength(2);
  });

  it("does not read the list again when it already reflects the finished pass", async () => {
    const api = await import("../../../../src/composables/libraryApi");
    const reads = vi.spyOn(api, "loadLibraryPage");
    await mountLibrary();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushPromises();
    expect(reads).toHaveBeenCalledTimes(1);
    reads.mockRestore();
  });

  it("reads the list again after a failed read, even with the index idle", async () => {
    pageFailures = 2; // the opening read, and the retry on the first progress answer
    const wrapper = await mountLibrary();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushPromises();
    expect(wrapper.findAll("[data-testid=library-row]")).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, LIBRARY_STATUS_POLL_MS + 300));
    await flushPromises();
    expect(wrapper.findAll("[data-testid=library-row]")).toHaveLength(2);
  }, 10_000);

  it("reads the list again when its read fails after the poll has gone quiet", async () => {
    const api = await import("../../../../src/composables/libraryApi");
    let failPage: () => void = () => {};
    vi.spyOn(api, "loadLibraryPage").mockImplementationOnce(() => new Promise((resolve) => (failPage = () => resolve(null))));
    pageFinished = null;
    status = { indexing: false, filesDone: 0, filesTotal: 0, finishedAt: null }; // idle: the poll stops at once
    const wrapper = await mountLibrary();
    await new Promise((resolve) => setTimeout(resolve, 10));
    failPage(); // only now does the opening read fail
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, LIBRARY_STATUS_POLL_MS + 300));
    await flushPromises();
    expect(wrapper.findAll("[data-testid=library-row]")).toHaveLength(2);
  }, 10_000);

  it("runs the search again when a pass finishes, so a match indexed meanwhile appears", async () => {
    status = { indexing: true, filesDone: 1, filesTotal: 2, finishedAt: 1 };
    const wrapper = await mountLibrary();
    hits = [];
    await wrapper.find("[data-testid=library-search]").setValue("later");
    await new Promise((resolve) => setTimeout(resolve, 260));
    await flushPromises();
    expect(wrapper.find("[data-testid=library-no-match]").exists()).toBe(true);
    hits = [{ conversation: conversation("found", "Found after the pass"), snippet: "later", role: "user" }];
    status = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 2 };
    pageFinished = 2;
    await new Promise((resolve) => setTimeout(resolve, LIBRARY_STATUS_POLL_MS + 300));
    await flushPromises();
    expect(wrapper.findAll("[data-testid=library-row]").map((row) => row.text())).toEqual([expect.stringContaining("Found after the pass")]);
  }, 10_000);

  it("asks for progress again after a read, since a read can start a pass", async () => {
    const api = await import("../../../../src/composables/libraryApi");
    const asks = vi.spyOn(api, "loadLibraryStatus");
    const wrapper = await mountLibrary();
    const interval = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, LIBRARY_STATUS_POLL_MS + 300));
    await interval();
    await interval();
    const settled = asks.mock.calls.length;
    await interval();
    expect(asks.mock.calls).toHaveLength(settled); // quiet: the index idle, the list current
    hits = [];
    await wrapper.find("[data-testid=library-search]").setValue("anything");
    await new Promise((resolve) => setTimeout(resolve, 260));
    await interval();
    await flushPromises();
    expect(asks.mock.calls.length).toBeGreaterThan(settled);
    asks.mockRestore();
  }, 25_000);

  it("blocks Enter while a search re-run after a pass is pending", async () => {
    const api = await import("../../../../src/composables/libraryApi");
    status = { indexing: true, filesDone: 1, filesTotal: 2, finishedAt: 1 };
    const wrapper = await mountLibrary();
    hits = [{ conversation: page[0] ?? conversation("x", "x"), snippet: "first", role: "user" }];
    await wrapper.find("[data-testid=library-search]").setValue("first");
    await new Promise((resolve) => setTimeout(resolve, 260));
    await flushPromises();
    // The pass ends; its search re-run is held, so it is pending when Enter arrives.
    let releaseSearch: () => void = () => {};
    vi.spyOn(api, "searchLibrary").mockImplementationOnce(() => new Promise((resolve) => (releaseSearch = () => resolve(hits))));
    status = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 2 };
    pageFinished = 2;
    await new Promise((resolve) => setTimeout(resolve, LIBRARY_STATUS_POLL_MS + 200));
    await press("Enter");
    releaseSearch();
    await flushPromises();
    expect(opened).toEqual([]);
  }, 10_000);

  it("keeps a wake that arrives while a progress answer is on its way", async () => {
    const api = await import("../../../../src/composables/libraryApi");
    const wrapper = await mountLibrary();
    const interval = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, LIBRARY_STATUS_POLL_MS + 300));
    await interval();
    await interval(); // quiet now
    let release: () => void = () => {};
    statusGate = new Promise((resolve) => (release = resolve));
    hits = [];
    await wrapper.find("[data-testid=library-search]").setValue("first"); // its answer wakes the poll
    await new Promise((resolve) => setTimeout(resolve, 260));
    await interval(); // that tick is now waiting on the held answer
    hits = []; // a new answer, so the screen sees a change
    await wrapper.find("[data-testid=library-search]").setValue("second"); // a wake while it waits
    await new Promise((resolve) => setTimeout(resolve, 260));
    const asks = vi.spyOn(api, "loadLibraryStatus");
    release(); // the held answer: idle
    await flushPromises();
    await interval();
    expect(asks).toHaveBeenCalled();
    asks.mockRestore();
  }, 30_000);

  it("drops a resume still checking when another conversation is chosen", async () => {
    let release: () => void = () => {};
    loadGate = new Promise((resolve) => (release = resolve));
    await mountLibrary();
    await press("Enter");
    await press("ArrowDown");
    release();
    await flushPromises();
    expect(opened).toEqual([]);
  });

  it("keeps a refusal on screen through a list reload of the same row", async () => {
    openIds.push("a");
    status = { indexing: true, filesDone: 1, filesTotal: 2, finishedAt: 1 };
    const wrapper = await mountLibrary();
    await press("Enter");
    expect(wrapper.find("[role=status]").exists()).toBe(true);
    page = page.map((c) => ({ ...c })); // the same rows as new objects
    status = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 2 };
    pageFinished = 2;
    await new Promise((resolve) => setTimeout(resolve, LIBRARY_STATUS_POLL_MS + 300));
    await flushPromises();
    expect(wrapper.find("[role=status]").exists()).toBe(true);
  }, 10_000);

  it("links the reader's PR numbers to their pages", async () => {
    page = [
      conversation("a", "Burn subtitles", {
        prs: [{ number: 3345, repository: "receptron/mulmoterminal", url: "https://github.com/receptron/mulmoterminal/pull/3345" }],
      }),
    ];
    const wrapper = await mountLibrary();
    const link = wrapper.find("[data-testid=library-reader-prs] a");
    expect(link.text()).toBe("#3345");
    expect(link.attributes("href")).toBe("https://github.com/receptron/mulmoterminal/pull/3345");
    expect(link.attributes("rel")).toContain("noopener");
  });

  it("links the same PR number from two repositories as two PRs", async () => {
    page = [
      conversation("a", "Two repositories", {
        prs: [
          { number: 1, repository: "o/one", url: "https://github.com/o/one/pull/1" },
          { number: 1, repository: "o/two", url: "https://github.com/o/two/pull/1" },
        ],
      }),
    ];
    page = [
      ...page,
      conversation("b", "Two more", {
        prs: [
          { number: 1, repository: "o/three", url: "https://github.com/o/three/pull/1" },
          { number: 1, repository: "o/four", url: "https://github.com/o/four/pull/1" },
        ],
      }),
    ];
    const wrapper = await mountLibrary();
    await wrapper.findAll("[data-testid=library-row]")[1]?.trigger("click"); // the links update in place
    await flushPromises();
    expect(wrapper.findAll("[data-testid=library-reader-prs] a").map((link) => link.attributes("href"))).toEqual([
      "https://github.com/o/four/pull/1",
      "https://github.com/o/three/pull/1",
    ]);
  });

  it("switches to memory and back, the arrows moving through the memories there", async () => {
    const memory = (file: string) => ({ file, name: file.replace(".md", ""), description: null, type: null, updatedAt: NOW });
    memoryProjects = [{ slug: "-w-app", cwd: "/w/app", index: null, files: [memory("one.md"), memory("two.md")] }];
    memoryTexts = { "-w-app/one.md": { text: "first" }, "-w-app/two.md": { text: "second, see [[one]]" } };
    const wrapper = await mountLibrary();
    expect(wrapper.find("[data-testid=library-kind-memory]").text()).toContain("2");
    expect(wrapper.text()).toContain("Enter resume");
    await wrapper.find("[data-testid=library-kind-memory]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("one");
    expect(wrapper.text()).not.toContain("Enter resume"); // Enter does nothing in memory yet
    expect(wrapper.find("[data-testid=library-search]").attributes("aria-label")).toBe("Search memory");
    await press("ArrowDown");
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("two");
    // From a memory row that has focus too: the rows are buttons, and the arrows must still move.
    const first = wrapper.findAll("[data-testid=memory-row]")[0];
    await first?.trigger("click");
    (first?.element as HTMLElement | undefined)?.focus();
    first?.element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("two");
    // Enter on a focused row is the row's own: not swallowed by the Library.
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    wrapper.findAll("[data-testid=memory-row]")[0]?.element.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    // On a link in the body, the arrows are the link's, not the list's.
    const link = wrapper.find("[data-testid=memory-body] span[data-page]");
    link.element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("two");
    await wrapper.find("[data-testid=library-kind-conversations]").trigger("click");
    expect(wrapper.find("[data-testid=library-memory]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=library-reader]").exists()).toBe(true);
  });
});
