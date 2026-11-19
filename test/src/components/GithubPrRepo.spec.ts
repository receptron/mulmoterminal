// A PR row beside the conversation that made it (#3330): shown only where the Library knows one, and
// opening that conversation in the Library.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { LibraryConversation, LibraryPrCreator } from "../../../common/library";

let answer: LibraryPrCreator[] | null = [];
let gate: Promise<void> = Promise.resolve();
const asked: [string, number[]][] = [];
vi.mock("../../../src/composables/libraryApi", () => ({
  loadPrCreators: async (repository: string, numbers: number[]) => {
    asked.push([repository, [...numbers]]);
    const reply = answer;
    await gate;
    return reply;
  },
}));
const libraryViewOpen = vi.fn();
vi.mock("../../../src/composables/useLibraryView", () => ({ libraryViewOpen: (...args: unknown[]) => libraryViewOpen(...args) }));

const GithubPrRepo = (await import("../../../src/components/GithubPrRepo.vue")).default;

const pr = (number: number) => ({
  number,
  title: `PR ${String(number)}`,
  author: "a",
  updatedAt: new Date().toISOString(),
  isDraft: false,
  url: "u",
  review: null,
  ci: "none" as const,
});
const conversation = (id: string): LibraryConversation => ({
  ...{ id, agent: "claude", title: id, cwd: `/w/${id}`, gitBranch: null, prs: [], costUsd: null, linesAdded: null, linesRemoved: null },
  ...{ startedAt: null, endedAt: null, skills: [], hookErrors: 0, userTurns: 1, isSidechain: false, parentId: null, isTemporary: false, entrypoint: "cli" },
});

beforeEach(() => {
  answer = [];
  gate = Promise.resolve();
  asked.length = 0;
  libraryViewOpen.mockClear();
});

describe("GithubPrRepo and the Library", () => {
  it("asks about the listed PRs, offers the conversation only where one made the PR, and opens it", async () => {
    answer = [{ number: 3, conversation: conversation("opener") }];
    const w = mount(GithubPrRepo, { props: { repo: { repo: "octo/hello", prs: [pr(3), pr(4)] } } });
    await flushPromises();
    expect(asked).toEqual([["octo/hello", [3, 4]]]);
    const buttons = w.findAll("[data-testid=prs-open-conversation]");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.attributes("aria-label")).toBe("Open the conversation that made #3");
    await buttons[0]?.trigger("click");
    expect(libraryViewOpen).toHaveBeenCalledWith({ session: "opener", cwd: "/w/opener" });
  });

  it("shows the PRs with no buttons when the Library cannot answer", async () => {
    answer = null;
    const w = mount(GithubPrRepo, { props: { repo: { repo: "octo/hello", prs: [pr(3)] } } });
    await flushPromises();
    expect(w.findAll("[data-testid=prs-row]")).toHaveLength(1);
    expect(w.find("[data-testid=prs-open-conversation]").exists()).toBe(false);
  });

  it("does not ask about a repository that is not GitHub's owner/repo", async () => {
    mount(GithubPrRepo, { props: { repo: { repo: "gitlab.com/group/project", prs: [pr(3)] } } });
    await flushPromises();
    expect(asked).toEqual([]);
  });

  it("drops the last repository's buttons while the next one is asked", async () => {
    answer = [{ number: 3, conversation: conversation("first") }];
    const w = mount(GithubPrRepo, { props: { repo: { repo: "octo/one", prs: [pr(3)] } } });
    await flushPromises();
    expect(w.find("[data-testid=prs-open-conversation]").exists()).toBe(true);
    gate = new Promise(() => {}); // the next answer never comes
    await w.setProps({ repo: { repo: "octo/two", prs: [pr(3)] } });
    await flushPromises();
    expect(w.find("[data-testid=prs-open-conversation]").exists()).toBe(false);
  });
});
