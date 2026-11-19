// Pins and names on the Library screen (#3329), mounted with its reads stubbed: the More menu, rename
// in place, and saves answering late, out of order or not at all. The setup is the overlay spec's.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { LibraryConversation, LibraryIndexStatus, LibrarySearchHit } from "../../../../common/library";
import type { ResumableList } from "../../../../src/composables/useDirLists";

const libraryOpen = ref(true);
const closeLibrary = vi.fn();
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
const saved: { id: string; change: { pinned?: boolean; name?: string | null } }[] = [];
let saveFails = false;
let saveGate: Promise<void> = Promise.resolve();
let marksGate: Promise<void> = Promise.resolve();
let marksUnreadable = false;
let conversationGate: Promise<void> = Promise.resolve();
const conversationGates = new Map<string, Promise<void>>();
let more: { conversations: LibraryConversation[]; hasMore: boolean; indexFinishedAt: number | null } | null = null;
/** The finished pass the next first page says it reflects. */
let pageFinished: number | null = 1;
/** First pages that fail before one succeeds. */
let pageFailures = 0;
let firstHasMore = false;
vi.mock("../../../../src/composables/libraryApi", () => ({
  LIBRARY_PAGE: 50,
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
  loadLibraryConversation: async (id: string, cwd: string | null = null) => {
    const gate = conversationGates.get(id) ?? conversationGate;
    await gate;
    // As the server answers: the copy in `cwd` when named and present, else the newest (the page is newest first).
    return (cwd === null ? undefined : page.find((c) => c.id === id && c.cwd === cwd)) ?? page.find((c) => c.id === id) ?? null;
  },
  saveLibraryMark: async (id: string, change: { pinned?: boolean; name?: string | null }) => {
    saved.push({ id, change });
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

// The router outlives a test, and pushing the URL it already shows does not navigate: start each
// test from a plain Library so a request is always a change.
beforeEach(async () => {
  const { router } = await import("../../../../src/router");
  await router.replace({ name: "library", query: {} });
});

beforeEach(() => {
  requested = null;
  closeLibrary.mockClear();
  marks = { pinned: [], names: {} };
  saved.length = 0;
  saveFails = false;
  saveGate = Promise.resolve();
  marksGate = Promise.resolve();
  marksUnreadable = false;
  conversationGate = Promise.resolve();
  conversationGates.clear();
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

describe("LibraryOverlay pins and names", () => {
  it("pins the conversation from the More menu, and lists it first", async () => {
    const wrapper = await mountLibrary();
    await press("ArrowDown"); // the older one
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click");
    await flushPromises();
    expect(saved).toEqual([{ id: "b", change: { pinned: true } }]);
    expect(wrapper.findAll("[data-testid=library-row]")[0]?.text()).toContain("CI under ten minutes");
    expect(wrapper.text()).toContain("Pinned");
  });

  it("renames in place: Enter saves, and the list and reader show the new name", async () => {
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-rename-start]").trigger("click");
    const field = wrapper.find("[data-testid=library-rename]");
    await field.setValue("Subtitles, done");
    await field.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(saved).toEqual([{ id: "a", change: { name: "Subtitles, done" } }]);
    expect(wrapper.find("[data-testid=library-reader]").text()).toContain("Subtitles, done");
    expect(wrapper.findAll("[data-testid=library-row]")[0]?.text()).toContain("Subtitles, done");
    expect(opened).toEqual([]); // Enter in the name field is not a resume
  });

  it("cancels a rename on Esc without closing the Library", async () => {
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-rename-start]").trigger("click");
    const field = wrapper.find("[data-testid=library-rename]");
    await field.setValue("Not this");
    field.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(wrapper.find("[data-testid=library-rename]").exists()).toBe(false);
    expect(saved).toEqual([]);
    expect(closeLibrary).not.toHaveBeenCalled();
    await press("Escape"); // the same key outside the field does close it
    expect(closeLibrary).toHaveBeenCalled();
  });

  it("says so when a change could not be saved, and leaves the screen as it was", async () => {
    saveFails = true;
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[role=status]").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Pinned");
  });

  it("closes the More menu on Esc without closing the Library, and on a click elsewhere", async () => {
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    expect(wrapper.find("[role=menu]").exists()).toBe(true);
    await press("Escape");
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
    expect(closeLibrary).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(wrapper.find("[data-testid=library-more-actions]").element);
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await flushPromises();
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
  });

  it("keeps the newest change when an older save answers last", async () => {
    const wrapper = await mountLibrary();
    let releaseFirst: () => void = () => {};
    saveGate = new Promise((resolve) => (releaseFirst = resolve));
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click"); // its answer is held
    saveGate = Promise.resolve();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-rename-start]").trigger("click");
    await wrapper.find("[data-testid=library-rename]").setValue("Newest");
    await wrapper.find("[data-testid=library-rename]").trigger("keydown", { key: "Enter" });
    await flushPromises(); // the rename answers first, with both changes
    releaseFirst(); // then the pin's older answer arrives
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("Newest");
  });

  it("drops a rename begun on one conversation when another is chosen", async () => {
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-rename-start]").trigger("click");
    await wrapper.find("[data-testid=library-rename]").setValue("Meant for a");
    await wrapper.findAll("[data-testid=library-row]")[1]?.trigger("click"); // b
    await flushPromises();
    expect(wrapper.find("[data-testid=library-rename]").exists()).toBe(false);
    expect(saved.every((entry) => entry.id !== "b")).toBe(true);
  });

  it("puts a conversation in the pinned group even when its pin's own answer was superseded", async () => {
    const wrapper = await mountLibrary();
    await press("ArrowDown"); // b, the older one: only a pin puts it first
    let releasePin: () => void = () => {};
    saveGate = new Promise((resolve) => (releasePin = resolve));
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click"); // held
    saveGate = Promise.resolve();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-rename-start]").trigger("click");
    await wrapper.find("[data-testid=library-rename]").setValue("Pinned and named");
    await wrapper.find("[data-testid=library-rename]").trigger("keydown", { key: "Enter" });
    await flushPromises();
    releasePin();
    await flushPromises();
    expect(wrapper.findAll("[data-testid=library-row]")[0]?.text()).toContain("Pinned and named");
  });

  it("keeps a name saved while the opening read of the marks was still on its way", async () => {
    let releaseLoad: () => void = () => {};
    marksGate = new Promise((resolve) => (releaseLoad = resolve)); // answers with the marks as they were
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-rename-start]").trigger("click");
    await wrapper.find("[data-testid=library-rename]").setValue("Saved first");
    await wrapper.find("[data-testid=library-rename]").trigger("keydown", { key: "Enter" });
    await flushPromises();
    releaseLoad(); // the older read lands now
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("Saved first");
  });

  it("says the pins and names could not be read, rather than showing none", async () => {
    marksUnreadable = true;
    const wrapper = await mountLibrary();
    expect(wrapper.find("[role=status]").text()).toContain("could not be read");
  });

  it("shows a failed save only on the conversation it was about, even when it fails late", async () => {
    saveFails = true;
    let release: () => void = () => {};
    saveGate = new Promise((resolve) => (release = resolve));
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click"); // a's save, failing late
    await press("ArrowDown"); // b
    release();
    await flushPromises();
    expect(wrapper.find("[role=status]").exists()).toBe(false);
    await press("ArrowUp"); // back to a
    expect(wrapper.find("[role=status]").exists()).toBe(true);
  });

  it("reads the marks again when a save from before a reopen lands after the new read began", async () => {
    let releaseSave: () => void = () => {};
    saveGate = new Promise((resolve) => (releaseSave = resolve));
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click"); // applied on arrival, answered late
    const stale = { pinned: [], names: {} };
    libraryOpen.value = false;
    await flushPromises();
    let releaseLoad: () => void = () => {};
    marksGate = new Promise((resolve) => (releaseLoad = resolve));
    const realMarks = marks;
    marks = stale; // the reopened screen's read was taken before the pin landed
    libraryOpen.value = true;
    await flushPromises();
    marks = realMarks;
    marksGate = Promise.resolve();
    releaseSave(); // the old save answers first
    await flushPromises();
    releaseLoad(); // then the stale read
    await flushPromises();
    expect(wrapper.text()).toContain("Pinned");
  });

  it("drops the unreadable-marks notice once a change has been saved", async () => {
    marksUnreadable = true;
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[role=status]").exists()).toBe(false);
  });

  it("shows an older save that succeeded when the newer one failed", async () => {
    const wrapper = await mountLibrary();
    await press("ArrowDown"); // b: only a pin puts it first
    let releasePin: () => void = () => {};
    saveGate = new Promise((resolve) => (releasePin = resolve));
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click"); // succeeds, answers late
    saveGate = Promise.resolve();
    saveFails = true;
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-rename-start]").trigger("click");
    await wrapper.find("[data-testid=library-rename]").setValue("x");
    await wrapper.find("[data-testid=library-rename]").trigger("keydown", { key: "Enter" }); // fails now
    await flushPromises();
    saveFails = false;
    releasePin();
    await flushPromises();
    expect(wrapper.findAll("[data-testid=library-row]")[0]?.text()).toContain("CI under ten minutes");
  });

  it("moves through the More menu with the arrows, and closes it when focus leaves", async () => {
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await flushPromises();
    const items = wrapper.findAll("[role=menuitem]");
    expect(document.activeElement).toBe(items[0]?.element);
    await wrapper.find("[role=menu]").trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]?.element);
    await wrapper.find("[role=menu]").trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]?.element); // wraps
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("Burn subtitles"); // the list did not move
    await wrapper.find("[role=menu]").trigger("keydown", { key: "Tab" });
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
  });

  it("keeps the reader on a conversation while its pin is read back", async () => {
    const wrapper = await mountLibrary();
    await press("ArrowDown"); // b
    conversationGate = new Promise(() => {}); // reading the pinned conversations back never finishes here
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("CI under ten minutes");
    expect(wrapper.findAll("[data-testid=library-row]")[0]?.text()).toContain("CI under ten minutes");
  });

  it("stays on a pinned conversation from outside the list when it is unpinned", async () => {
    const old = conversation("old", "Pinned long ago", { endedAt: NOW - 400 * 24 * 3_600_000 });
    marks = { pinned: ["old"], names: {} };
    page = [...page, old]; // readable by id for the pinned group…
    const listed = page.slice(0, 2);
    const api = await import("../../../../src/composables/libraryApi");
    vi.spyOn(api, "loadLibraryPage").mockResolvedValue({ conversations: listed, hasMore: true, indexFinishedAt: 1 }); // …but not on the first page
    const wrapper = await mountLibrary();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("Pinned long ago");
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click"); // unpin
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("Pinned long ago");
    vi.mocked(api.loadLibraryPage).mockRestore();
  });

  it("says the pins and names could not be read even when nothing is listed", async () => {
    page = [];
    marksUnreadable = true;
    const wrapper = await mountLibrary();
    expect(wrapper.find("[data-testid=library-empty] [role=status]").text()).toContain("could not be read");
  });

  it("does not save the name on the Enter that confirms an input method's conversion", async () => {
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-rename-start]").trigger("click");
    const field = wrapper.find("[data-testid=library-rename]");
    await field.setValue("字幕");
    field.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    await flushPromises();
    expect(saved).toEqual([]);
    expect(wrapper.find("[data-testid=library-rename]").exists()).toBe(true);
  });

  it("ignores a marks read that began before a save the screen has since shown", async () => {
    const wrapper = await mountLibrary();
    // A reopen-style read is under way, holding the marks as they were…
    let releaseRead: () => void = () => {};
    marksGate = new Promise((resolve) => (releaseRead = resolve));
    libraryOpen.value = false;
    await flushPromises();
    libraryOpen.value = true;
    await flushPromises();
    marksGate = Promise.resolve();
    // …then a rename is saved and shown before that read answers.
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-rename-start]").trigger("click");
    await wrapper.find("[data-testid=library-rename]").setValue("Newer than the read");
    await wrapper.find("[data-testid=library-rename]").trigger("keydown", { key: "Enter" });
    await flushPromises();
    releaseRead();
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("Newer than the read");
  });

  it("treats two copies of one session id in different directories as two rows to read", async () => {
    page = [conversation("dup", "Copy one", { cwd: "/w/one" }), conversation("dup", "Copy two", { cwd: "/w/two", endedAt: NOW - 1000 })];
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-rename-start]").trigger("click");
    await press("ArrowDown"); // the other copy
    expect(wrapper.find("[data-testid=library-rename]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("Copy two");
  });

  it("closes the More menu when its own button is pressed again", async () => {
    const wrapper = await mountLibrary();
    const button = wrapper.find("[data-testid=library-more-actions]");
    await button.trigger("click");
    expect(wrapper.find("[role=menu]").exists()).toBe(true);
    // As a browser does it: pointerdown first (the outside-press listener), then the click.
    button.element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await button.trigger("click");
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
  });

  it("records a late failure on its own conversation even after a newer save succeeded", async () => {
    let releaseFirst: () => void = () => {};
    saveGate = new Promise((resolve) => (releaseFirst = resolve));
    saveFails = true;
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click"); // a: will fail, late
    saveGate = Promise.resolve();
    saveFails = false;
    await press("ArrowDown"); // b
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click"); // b: succeeds first
    await flushPromises();
    releaseFirst();
    await flushPromises();
    expect(wrapper.find("[role=status]").exists()).toBe(false); // not b's
    // Back to a by its row: b, now pinned, sits above it.
    await wrapper
      .findAll("[data-testid=library-row]")
      .find((row) => row.text().includes("Burn subtitles"))
      ?.trigger("click");
    expect(wrapper.find("[role=status]").exists()).toBe(true);
  });

  it("keeps one conversation's failure when another is then saved", async () => {
    saveFails = true;
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click"); // a fails
    await flushPromises();
    saveFails = false;
    await press("ArrowDown"); // b
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-rename-start]").trigger("click");
    await wrapper.find("[data-testid=library-rename]").setValue("B named");
    await wrapper.find("[data-testid=library-rename]").trigger("keydown", { key: "Enter" });
    await flushPromises();
    await wrapper
      .findAll("[data-testid=library-row]")
      .find((row) => row.text().includes("Burn subtitles"))
      ?.trigger("click");
    expect(wrapper.find("[role=status]").exists()).toBe(true);
  });

  it("does not keep a conversation held from the list as the row Enter acts on in search results", async () => {
    const old = conversation("old", "Pinned long ago", { endedAt: NOW - 400 * 24 * 3_600_000 });
    marks = { pinned: ["old"], names: {} };
    page = [...page, old];
    const api = await import("../../../../src/composables/libraryApi");
    vi.spyOn(api, "loadLibraryPage").mockResolvedValue({ conversations: page.slice(0, 2), hasMore: true, indexFinishedAt: 1 });
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click"); // unpin: held, though no longer listed
    await flushPromises();
    vi.spyOn(api, "searchLibrary").mockResolvedValueOnce([{ conversation: page[1] ?? old, snippet: "ten", role: "user" }]);
    await wrapper.find("[data-testid=library-search]").setValue("ten");
    await new Promise((resolve) => setTimeout(resolve, 260));
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("CI under ten minutes");
    vi.mocked(api.loadLibraryPage).mockRestore();
  });

  it("keeps the reader on the last conversation when unpinning it empties the list", async () => {
    const only = conversation("only", "The only one");
    page = [only];
    marks = { pinned: ["only"], names: {} };
    const api = await import("../../../../src/composables/libraryApi");
    vi.spyOn(api, "loadLibraryPage").mockResolvedValue({ conversations: [], hasMore: false, indexFinishedAt: 1 });
    const wrapper = await mountLibrary();
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await wrapper.find("[data-testid=library-pin]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("The only one");
    vi.mocked(api.loadLibraryPage).mockRestore();
  });

  it("opens on the conversation a cell's History menu named, even one not on the first page", async () => {
    const old = conversation("from-a-cell", "Opened from its cell", { endedAt: NOW - 400 * 24 * 3_600_000 });
    page = [...page, old]; // readable by id…
    const api = await import("../../../../src/composables/libraryApi");
    vi.spyOn(api, "loadLibraryPage").mockResolvedValue({ conversations: page.slice(0, 2), hasMore: true, indexFinishedAt: 1 }); // …not listed
    requested = { session: "from-a-cell", cwd: null };
    const wrapper = await mountLibrary();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("Opened from its cell");
    vi.mocked(api.loadLibraryPage).mockRestore();
  });

  it("opens on the copy of a session in the cell's own project when one id sits in two", async () => {
    page = [conversation("twin", "In the clip studio"), conversation("twin", "In the other project", { cwd: "/Users/me/work/other" }), ...page];
    const wrapper = await mountLibrary(); // both copies listed before the request arrives
    requested = { session: "twin", cwd: "/Users/me/work/other" };
    const { router } = await import("../../../../src/router");
    await router.push({ name: "library", query: { session: "twin", cwd: "/Users/me/work/other" } });
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("In the other project");
  });

  it("lets the newer of two requests decide, whichever answers first", async () => {
    const older = conversation("older", "Asked for first", { endedAt: NOW - 400 * 24 * 3_600_000 });
    const newer = conversation("newer", "Asked for second", { endedAt: NOW - 400 * 24 * 3_600_000 });
    page = [...page, older, newer];
    const api = await import("../../../../src/composables/libraryApi");
    vi.spyOn(api, "loadLibraryPage").mockResolvedValue({ conversations: page.slice(0, 2), hasMore: true, indexFinishedAt: 1 });
    let releaseOlder: () => void = () => {};
    conversationGates.set("older", new Promise((resolve) => (releaseOlder = resolve)));
    requested = { session: "older", cwd: null };
    const { router } = await import("../../../../src/router");
    const wrapper = await mountLibrary();
    requested = { session: "newer", cwd: null };
    await router.push({ name: "library", query: { session: "newer" } });
    await flushPromises();
    releaseOlder();
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("Asked for second");
    vi.mocked(api.loadLibraryPage).mockRestore();
  });

  it("drops a request still loading when the Library is then opened plainly", async () => {
    const asked = conversation("asked", "Asked for, then withdrawn", { endedAt: NOW - 400 * 24 * 3_600_000 });
    page = [...page, asked];
    const api = await import("../../../../src/composables/libraryApi");
    vi.spyOn(api, "loadLibraryPage").mockResolvedValue({ conversations: page.slice(0, 2), hasMore: true, indexFinishedAt: 1 });
    let release: () => void = () => {};
    conversationGates.set("asked", new Promise((resolve) => (release = resolve)));
    const { router } = await import("../../../../src/router");
    const wrapper = await mountLibrary();
    requested = { session: "asked", cwd: null };
    await router.push({ name: "library", query: { session: "asked" } });
    requested = null;
    await router.push({ name: "library", query: {} });
    await flushPromises();
    release();
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).not.toContain("withdrawn");
    vi.mocked(api.loadLibraryPage).mockRestore();
  });

  it("opens the newest copy, as the server picks it, when no project is named", async () => {
    page = [conversation("twin", "Newer copy"), conversation("twin", "Older copy without a project", { cwd: null, endedAt: NOW - 3_600_000 }), ...page];
    const wrapper = await mountLibrary();
    requested = { session: "twin", cwd: null };
    const { router } = await import("../../../../src/router");
    await router.push({ name: "library", query: { session: "twin" } });
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).toContain("Newer copy");
  });

  it.each(["click", "arrow"])("keeps the row the user picked (by %s) over a request that answers later", async (how) => {
    const id = `asked-by-${how}`;
    const asked = conversation(id, "Asked for, then passed over", { endedAt: NOW - 400 * 24 * 3_600_000 });
    page = [...page, asked];
    const api = await import("../../../../src/composables/libraryApi");
    vi.spyOn(api, "loadLibraryPage").mockResolvedValue({ conversations: page.slice(0, 2), hasMore: true, indexFinishedAt: 1 });
    let release: () => void = () => {};
    conversationGates.set(id, new Promise((resolve) => (release = resolve)));
    const { router } = await import("../../../../src/router");
    const wrapper = await mountLibrary();
    requested = { session: id, cwd: null };
    await router.push({ name: "library", query: { session: id } });
    if (how === "click") await wrapper.findAll("[data-testid=library-row]")[1]?.trigger("click");
    else await press("ArrowDown");
    release();
    await flushPromises();
    expect(wrapper.find("[data-testid=library-reader] h2").text()).not.toContain("passed over");
    vi.mocked(api.loadLibraryPage).mockRestore();
  });
});
