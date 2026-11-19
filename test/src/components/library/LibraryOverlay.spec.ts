// The Library screen (#3329), mounted with its reads stubbed: the list and the reader, search and its
// empty answer, the keys, and what Enter resumes — or why it will not.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { LibraryConversation, LibraryIndexStatus, LibrarySearchHit } from "../../../../common/library";
import type { ResumableList } from "../../../../src/composables/useDirLists";

vi.mock("../../../../src/composables/useLibraryView", () => ({ useLibraryView: () => ({ isOpen: ref(true), close: vi.fn() }) }));

let page: LibraryConversation[] = [];
let status: LibraryIndexStatus | null = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 1 };
let hits: LibrarySearchHit[] = [];
vi.mock("../../../../src/composables/libraryApi", () => ({
  LIBRARY_PAGE: 50,
  loadLibraryPage: () => Promise.resolve({ conversations: page, hasMore: false }),
  loadLibraryStatus: () => Promise.resolve(status),
  searchLibrary: () => Promise.resolve(hits),
}));

const opened: unknown[] = [];
vi.mock("../../../../src/composables/useNewTerminal", () => ({ openCellAt: (cell: unknown) => opened.push(cell) }));

let resumableList: ResumableList = { sessions: [], cwd: null };
vi.mock("../../../../src/composables/useDirLists", () => ({
  useResumableSessions: () => ({
    value: {
      get value() {
        return resumableList;
      },
    },
    forget: vi.fn(),
    load: () => Promise.resolve(),
  }),
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

beforeEach(() => {
  page = [conversation("a", "Burn subtitles"), conversation("b", "CI under ten minutes", { endedAt: NOW - 30 * 24 * 3_600_000 })];
  status = { indexing: false, filesDone: 2, filesTotal: 2, finishedAt: 1 };
  hits = [];
  opened.length = 0;
  openIds.length = 0;
  resumableList = { sessions: [], cwd: null };
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
});
