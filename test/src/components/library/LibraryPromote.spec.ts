// Promoting a conversation from the Library (#3334): the reader's five targets, and what starting one
// does — the session placed in the grid, or the sentence for why there is none.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import type { LibraryConversation } from "../../../../common/library";

const promotes: unknown[][] = [];
let promoteAnswer: { kind: string; chatId?: string } = { kind: "started", chatId: "new-chat" };
vi.mock("../../../../src/composables/libraryApi", () => ({
  promoteLibraryConversation: (id: string, cwd: string | null, target: string) => {
    promotes.push([id, cwd, target]);
    return Promise.resolve(promoteAnswer);
  },
  loadLibraryFiles: () => Promise.resolve([]),
}));
const placed: unknown[] = [];
vi.mock("../../../../src/composables/useSpawnedChat", () => ({ placeSpawnedChat: (request: unknown) => placed.push(request) > 0 }));

const LibraryReader = (await import("../../../../src/components/library/LibraryReader.vue")).default;
const { startPromote } = await import("../../../../src/components/library/libraryPromoteStart");

const NOW = Date.now();
const conversation: LibraryConversation = {
  ...{ id: "c1", agent: "claude", title: "Burn subtitles", cwd: "/w/clip", gitBranch: "main", prs: [], costUsd: null, linesAdded: null, linesRemoved: null },
  ...{ startedAt: NOW, endedAt: NOW, skills: [], hookErrors: 0, userTurns: 1, isSidechain: false, parentId: null, isTemporary: false, entrypoint: "cli" },
};

beforeEach(() => {
  promotes.length = 0;
  placed.length = 0;
  promoteAnswer = { kind: "started", chatId: "new-chat" };
});

describe("the reader's Promote items", () => {
  it("lists the five targets in the More menu, and pressing one asks for it and closes the menu", async () => {
    const wrapper = mount(LibraryReader, {
      props: { conversation, now: NOW, notice: null, name: null, pinned: false },
      attachTo: document.body,
      global: { stubs: { TranscriptPane: true, LibraryChangedFiles: true } },
    });
    await wrapper.find("[data-testid=library-more-actions]").trigger("click");
    await flushPromises();
    expect(wrapper.findAll("[data-testid^=library-promote-]").map((item) => item.text())).toEqual([
      "psychologyA memory",
      "gavelA CLAUDE.md rule",
      "mapA plan",
      "bug_reportAn issue",
      "constructionA skill",
    ]);
    await wrapper.find("[data-testid=library-promote-plan]").trigger("click");
    expect(wrapper.emitted("promote")).toEqual([["plan"]]);
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("startPromote", () => {
  it("asks for the conversation's session and places it in the grid as a running cell", async () => {
    expect(await startPromote(conversation, "skill")).toBeNull();
    expect(promotes).toEqual([["c1", "/w/clip", "skill"]]);
    expect(placed).toEqual([{ id: "new-chat", agent: "claude", draft: false }]);
  });

  it("names why none was started, and places nothing", async () => {
    const refusals = [];
    for (const kind of ["gone", "no-dir", "failed"]) {
      promoteAnswer = { kind };
      refusals.push(await startPromote(conversation, "memory"));
    }
    expect(refusals).toEqual(["libraryView.promote.gone", "libraryView.promote.noDir", "libraryView.promote.failed"]);
    expect(placed).toEqual([]);
  });
});
