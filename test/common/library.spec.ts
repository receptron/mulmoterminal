// @vitest-environment node
// The Library's wire shapes read back on the client (#3329): what the server sends passes, and
// anything off-shape is rejected rather than rendered.
import { describe, it, expect } from "vitest";
import { isLibraryConversation, isLibraryIndexStatus, isLibrarySearchHit, type LibraryConversation } from "../../common/library";

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
