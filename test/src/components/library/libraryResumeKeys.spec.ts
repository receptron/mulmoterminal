// What Enter does in the Library (#3329): which conversation it resumes, as what, or why it will not;
// and which keys the screen takes at all.
import { describe, it, expect } from "vitest";
import { libraryResume } from "../../../../src/components/library/libraryResume";
import { libraryKeyAction, movedIndex, type LibraryKeyEvent } from "../../../../src/components/library/libraryKeys";
import type { LibraryConversation } from "../../../../common/library";
import type { ResumableList } from "../../../../src/composables/useDirLists";

const conversation = (over: Partial<LibraryConversation> = {}): LibraryConversation => ({
  ...{ id: "abc", agent: "claude", title: "T", cwd: "/w", gitBranch: null, prs: [], costUsd: null, linesAdded: null, linesRemoved: null },
  ...{ startedAt: null, endedAt: null, skills: [], hookErrors: 0, userTurns: 1, isSidechain: false, parentId: null, isTemporary: false, entrypoint: "cli" },
  ...over,
});
const list = (sessions: ResumableList["sessions"], cwd = "/real/w"): ResumableList => ({ sessions, cwd });

describe("libraryResume", () => {
  it("resumes by the running key, in the directory the list was read for, under its account", () => {
    const listed = list([{ id: "abc", title: "T", mtime: 1, runningKey: "tmux-1", account: "work" }]);
    expect(libraryResume(conversation(), listed, [])).toEqual({ kind: "open", id: "tmux-1", cwd: "/real/w", account: "work" });
  });

  it("resumes by its own id when the list was read and does not have it", () => {
    expect(libraryResume(conversation(), list([], "/real/w"), [])).toEqual({ kind: "open", id: "abc", cwd: "/w", account: null });
  });

  it("resumes nothing on a list that could not be read: it proves nothing about who holds the session", () => {
    expect(libraryResume(conversation(), null, [])).toEqual({ kind: "unchecked" });
  });

  it.each([
    ["held by another client", list([{ id: "abc", title: "T", mtime: 1, attached: true }]), []],
    ["already open in this grid", list([{ id: "abc", title: "T", mtime: 1 }]), ["abc"]],
    ["open under its running key", list([{ id: "abc", title: "T", mtime: 1, runningKey: "tmux-1" }]), ["tmux-1"]],
    ["open, though the list does not have it", list([]), ["abc"]],
  ] as const)("refuses a conversation %s", (_label, listed, open) => {
    expect(libraryResume(conversation(), listed, open)).toEqual({ kind: "busy" });
  });

  it("refuses a conversation with no directory", () => {
    expect(libraryResume(conversation({ cwd: null }), null, [])).toEqual({ kind: "no-cwd" });
  });
});

describe("libraryKeyAction", () => {
  const key = (k: string, over: Partial<LibraryKeyEvent> = {}): LibraryKeyEvent => ({
    key: k,
    inSearch: false,
    inOtherField: false,
    composing: false,
    modified: false,
    ...over,
  });

  it.each([
    [key("/"), "focus-search"],
    [key("/", { inSearch: true }), null],
    [key("ArrowUp", { inSearch: true }), "up"],
    [key("ArrowDown"), "down"],
    [key("Enter", { inSearch: true }), "primary"],
    [key("Enter", { composing: true, inSearch: true }), null],
    [key("Enter", { inOtherField: true }), null],
    [key("ArrowDown", { modified: true }), null],
    [key("a"), null],
  ] as const)("%j → %s", (event, expected) => {
    expect(libraryKeyAction(event)).toBe(expected);
  });
});

describe("movedIndex", () => {
  it.each([
    [0, 1, 3, 1],
    [2, 1, 3, 2],
    [0, -1, 3, 0],
    [-1, 1, 3, 0],
    [-1, -1, 3, 0],
    [0, 1, 0, -1],
  ])("from %i by %i in %i → %i", (current, by, length, expected) => {
    expect(movedIndex(current, by, length)).toBe(expected);
  });
});
