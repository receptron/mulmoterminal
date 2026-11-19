// A PR row beside the conversation that made it (#3330): shown only where the Library knows one, and
// opening that conversation in the Library.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { LibraryConversation } from "../../../common/library";

let answer: LibraryConversation[] | null = [];
const asked: string[] = [];
vi.mock("../../../src/composables/libraryApi", () => ({
  loadRepositoryConversations: (repository: string) => (asked.push(repository), Promise.resolve(answer)),
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
const madeBy = (id: string, numbers: number[]): LibraryConversation => ({
  ...{ id, agent: "claude", title: id, cwd: `/w/${id}`, gitBranch: null, costUsd: null, linesAdded: null, linesRemoved: null },
  ...{ startedAt: null, endedAt: null, skills: [], hookErrors: 0, userTurns: 1, isSidechain: false, parentId: null, isTemporary: false, entrypoint: "cli" },
  prs: numbers.map((number) => ({ number, repository: "octo/hello", url: `https://github.com/octo/hello/pull/${String(number)}` })),
});

beforeEach(() => {
  answer = [];
  asked.length = 0;
  libraryViewOpen.mockClear();
});

describe("GithubPrRepo and the Library", () => {
  it("offers the conversation only on a PR one made, and opens it in the Library", async () => {
    answer = [madeBy("opener", [3])];
    const w = mount(GithubPrRepo, { props: { repo: { repo: "octo/hello", prs: [pr(3), pr(4)] } } });
    await flushPromises();
    expect(asked).toEqual(["octo/hello"]);
    const buttons = w.findAll("[data-testid=prs-open-conversation]");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.attributes("aria-label")).toBe("Open the conversation that made this PR");
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
});
