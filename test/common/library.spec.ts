// @vitest-environment node
// The Library's wire shapes read back on the client (#3329): what the server sends passes, and
// anything off-shape is rejected rather than rendered.
import { describe, it, expect } from "vitest";
import {
  isLibraryConversation,
  isLibraryIndexStatus,
  isLibraryMarks,
  isLibraryPrCreator,
  isLibrarySearchHit,
  isRepositoryName,
  LIBRARY_NAME_MAX,
  type LibraryConversation,
} from "../../common/library";

const valid: LibraryConversation = {
  ...{ id: "s", agent: "claude", title: null, cwd: "/w", gitBranch: null, prs: [{ number: 1, url: "u", repository: "o/r" }], costUsd: 1.5 },
  ...{
    linesAdded: 3,
    linesRemoved: null,
    startedAt: 1,
    endedAt: 2,
    skills: ["k"],
    hookErrors: 0,
    userTurns: 2,
    isSidechain: false,
    parentId: null,
    isTemporary: false,
    entrypoint: "cli",
  },
};

describe("isLibraryConversation", () => {
  it("accepts what the server sends", () => {
    expect(isLibraryConversation(valid)).toBe(true);
  });

  it.each([
    ["null", null],
    ["an unknown agent", { ...valid, agent: "eliza" }],
    ["a numeric title", { ...valid, title: 3 }],
    ["a string cost", { ...valid, costUsd: "1" }],
    ["a malformed PR", { ...valid, prs: [{ number: "1" }] }],
    ["a non-string skill", { ...valid, skills: [1] }],
    ["a missing flag", (({ isTemporary: _drop, ...rest }) => rest)(valid)],
  ])("rejects %s", (_label, value) => {
    expect(isLibraryConversation(value)).toBe(false);
  });
});

describe("isLibrarySearchHit and isLibraryIndexStatus", () => {
  it("accept their shapes and reject others", () => {
    expect(isLibrarySearchHit({ conversation: valid, snippet: "s", role: "user" })).toBe(true);
    expect(isLibrarySearchHit({ conversation: valid, snippet: null, role: null })).toBe(true);
    expect(isLibrarySearchHit({ conversation: valid, snippet: null, role: "system" })).toBe(false);
    expect(isLibrarySearchHit({ conversation: {}, snippet: null, role: null })).toBe(false);
    expect(isLibraryIndexStatus({ indexing: true, filesDone: 1, filesTotal: 2, finishedAt: null })).toBe(true);
    expect(isLibraryIndexStatus({ indexing: "yes", filesDone: 1, filesTotal: 2, finishedAt: null })).toBe(false);
  });
});

describe("isLibraryMarks", () => {
  it("accepts what the server writes", () => {
    expect(isLibraryMarks({ pinned: ["a", "b"], names: { a: "Mine" } })).toBe(true);
    expect(isLibraryMarks({ pinned: [], names: {} })).toBe(true);
  });

  it.each([
    ["an empty id", { pinned: [""], names: {} }],
    ["a pin twice", { pinned: ["a", "a"], names: {} }],
    ["an empty name key", { pinned: [], names: { "": "x" } }],
    ["a blank name", { pinned: [], names: { a: "  " } }],
    ["a name past the cap", { pinned: [], names: { a: "x".repeat(LIBRARY_NAME_MAX + 1) } }],
    ["a non-string name", { pinned: [], names: { a: 3 } }],
    ["no names", { pinned: [] }],
    ["a field this code never writes", { pinned: [], names: {}, pinnd: ["a"] }],
    ["a name on two lines", { pinned: [], names: { a: "A\nB" } }],
  ])("refuses %s", (_label, value) => {
    expect(isLibraryMarks(value)).toBe(false);
  });
});

describe("isRepositoryName", () => {
  it.each([
    ["receptron/mulmoterminal", true],
    ["a.b/c-d_e", true],
    ["receptron", false],
    ["a/b/c", false],
    ["gitlab.com/group/project", false],
    ["../x", false],
    ["x/..", false],
    ["a b/c", false],
    ["", false],
  ])("%s → %s", (name, ok) => {
    expect(isRepositoryName(name)).toBe(ok);
  });
});

describe("isLibraryPrCreator", () => {
  it("needs an integer number and a conversation", () => {
    expect(isLibraryPrCreator({ number: 3, conversation: valid })).toBe(true);
    expect(isLibraryPrCreator({ number: 3, conversation: {} })).toBe(false);
    expect(isLibraryPrCreator({ number: 3.5, conversation: null })).toBe(false);
    expect(isLibraryPrCreator(null)).toBe(false);
  });
});
