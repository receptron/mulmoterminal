// A conversation and the pull requests it made (#3330): which conversation made a PR, which PR links
// may be opened, and the reader's grey line with its PRs apart.
import { describe, it, expect } from "vitest";
import { creatorsByPr, prPage } from "../../../../src/components/library/prConversations";
import { readerMetaParts } from "../../../../src/components/library/libraryRows";
import type { LibraryConversation, LibraryPrLink } from "../../../../common/library";

const NOW = new Date(2026, 10, 19, 15, 0, 0).getTime();
const link = (number: number, repository = "receptron/mulmoterminal"): LibraryPrLink => ({
  number,
  repository,
  url: `https://github.com/${repository}/pull/${String(number)}`,
});
const conversation = (id: string, prs: LibraryPrLink[], over: Partial<LibraryConversation> = {}): LibraryConversation => ({
  ...{ id, agent: "claude", title: id, cwd: "/w/app", gitBranch: "main", prs, costUsd: null, linesAdded: null, linesRemoved: null },
  ...{ startedAt: null, endedAt: NOW, skills: [], hookErrors: 0, userTurns: 1, isSidechain: false, parentId: null, isTemporary: false, entrypoint: "cli" },
  ...over,
});

describe("creatorsByPr", () => {
  it("gives each PR the first conversation that linked it, in the order given (earliest begun first)", () => {
    const opener = conversation("opener", [link(1), link(2)]);
    const reviewer = conversation("review-loop", [link(2), link(3)]);
    const creators = creatorsByPr([opener, reviewer], "receptron/mulmoterminal");
    expect([...creators].map(([number, c]) => [number, c.id])).toEqual([
      [1, "opener"],
      [2, "opener"],
      [3, "review-loop"],
    ]);
  });

  it("matches the repository in any case, and nothing in another repository", () => {
    const creators = creatorsByPr([conversation("a", [link(7, "Receptron/MulmoTerminal"), link(8, "receptron/other")])], "receptron/mulmoterminal");
    expect([...creators.keys()]).toEqual([7]);
  });

  it("is empty with no conversations", () => {
    expect(creatorsByPr([], "o/r").size).toBe(0);
  });
});

describe("prPage", () => {
  it.each([
    ["https://github.com/o/r/pull/1", true],
    ["//github.com/o/r/pull/1", false],
    ["https://github.com.evil.example/o/r/pull/1", false],
    ["javascript:alert(1)", false],
    ["https://github.com/o/r/pull/1 extra", false],
    ["", false],
  ])("%s → %s", (url, opens) => {
    expect(prPage({ number: 1, repository: "o/r", url })).toBe(opens ? url : null);
  });
});

describe("readerMetaParts", () => {
  it("keeps the PRs apart, newest first, each with its page, and counts the rest", () => {
    const parts = readerMetaParts(conversation("a", [link(1), link(2), link(3), link(4)]), NOW, "en-US");
    expect(parts.map((part) => part.kind)).toEqual(["text", "text", "prs", "text"]);
    const prs = parts.find((part) => part.kind === "prs");
    expect(prs?.kind === "prs" ? prs.prs : null).toEqual([
      { text: "#4", url: "https://github.com/receptron/mulmoterminal/pull/4" },
      { text: "#3", url: "https://github.com/receptron/mulmoterminal/pull/3" },
      { text: "#2", url: "https://github.com/receptron/mulmoterminal/pull/2" },
      { text: "+1", url: null },
    ]);
  });

  it("leaves out absent parts, and the PRs when there are none", () => {
    expect(readerMetaParts(conversation("a", [], { cwd: null, gitBranch: null, endedAt: null }), NOW, "en-US")).toEqual([]);
  });

  it("does not link a PR whose recorded URL is not a GitHub page", () => {
    const parts = readerMetaParts(conversation("a", [{ number: 9, repository: "o/r", url: "javascript:alert(1)" }]), NOW, "en-US");
    const prs = parts.find((part) => part.kind === "prs");
    expect(prs?.kind === "prs" ? prs.prs : null).toEqual([{ text: "#9", url: null }]);
  });
});
