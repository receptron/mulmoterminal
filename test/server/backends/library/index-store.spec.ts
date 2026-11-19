// @vitest-environment node
// The Library index's tables (#3328), on an in-memory database: rebuilding on a schema change, a
// scan that lost the race, the lease, and search.
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  applyHistoryScan,
  applyTranscriptScan,
  finishLease,
  LIBRARY_SCHEMA_VERSION,
  prepareLibraryStore,
  readFileMark,
  readLease,
  recordProgress,
  removeMissingTranscripts,
  takeLease,
  type TranscriptScan,
} from "../../../../server/backends/library/index-store";
import { conversationOfRow, findConversation, listConversations } from "../../../../server/backends/library/index-queries";
import { searchLibrary } from "../../../../server/backends/library/library-search";
import { emptyConversationState, type ConversationState, type IndexedTurn } from "../../../../server/backends/library/conversation-fold";

const freshDb = (): DatabaseSync => {
  const db = new DatabaseSync(":memory:");
  prepareLibraryStore(db);
  return db;
};

const scanOf = (id: string, overrides: Omit<Partial<TranscriptScan>, "state"> & { state?: Partial<ConversationState> } = {}): TranscriptScan => ({
  path: `/p/${id}.jsonl`,
  id,
  agent: "claude",
  parentId: null,
  isTemporary: false,
  stamp: { size: 10, mtimeMs: 1 },
  from: 0,
  to: 10,
  restart: true,
  ...overrides,
  state: { ...emptyConversationState(), ...overrides.state },
  turns: overrides.turns ?? [],
});

const turn = (text: string, role: IndexedTurn["role"] = "user"): IndexedTurn => ({ role, text, at: null });
const turnCount = (db: DatabaseSync): number => Number(db.prepare("select count(*) as n from turns").get()?.n);

describe("prepareLibraryStore", () => {
  it("keeps the data across a reopen at the same schema, and drops it at another", () => {
    const db = freshDb();
    applyTranscriptScan(db, scanOf("a", { turns: [turn("hello world")] }));
    prepareLibraryStore(db);
    expect(listConversations(db, {}, 0, 10)).toHaveLength(1);
    db.prepare("update meta set value = ? where key = 'schema'").run(String(LIBRARY_SCHEMA_VERSION + 1));
    prepareLibraryStore(db);
    expect(listConversations(db, {}, 0, 10)).toHaveLength(0);
    expect(turnCount(db)).toBe(0);
    expect(searchLibrary(db, "hello", {}, 10)).toEqual([]);
  });
});

describe("applyTranscriptScan", () => {
  it("continues only from the offset it found, and refuses a scan another process overtook", () => {
    const db = freshDb();
    expect(applyTranscriptScan(db, scanOf("a", { to: 10, turns: [turn("one")] }))).toBe(true);
    expect(applyTranscriptScan(db, scanOf("a", { restart: false, from: 10, to: 20, stamp: { size: 20, mtimeMs: 2 }, turns: [turn("two")] }))).toBe(true);
    // Started from 10 too, but the index is at 20 now: its turns would be a duplicate.
    expect(applyTranscriptScan(db, scanOf("a", { restart: false, from: 10, to: 20, turns: [turn("two")] }))).toBe(false);
    expect(turnCount(db)).toBe(2);
    expect(readFileMark(db, "/p/a.jsonl")?.scannedTo).toBe(20);
  });

  it("replaces a conversation's turns on a restart, but keeps its prompt-history rows", () => {
    const db = freshDb();
    applyTranscriptScan(db, scanOf("a", { turns: [turn("old text")] }));
    applyHistoryScan(db, {
      path: "/h",
      stamp: { size: 5, mtimeMs: 1 },
      from: 0,
      to: 5,
      restart: true,
      prompts: [{ sessionId: "a", text: "typed prompt", at: 1 }],
    });
    applyTranscriptScan(db, scanOf("a", { turns: [turn("new text")] }));
    expect(searchLibrary(db, "old text", {}, 10)).toEqual([]);
    expect(searchLibrary(db, "new text", {}, 10)).toHaveLength(1);
    expect(searchLibrary(db, "typed prompt", {}, 10)[0]?.role).toBe("prompt");
  });

  it("drops the text of a conversation once it turns out to be temporary", () => {
    const db = freshDb();
    applyTranscriptScan(db, scanOf("a", { turns: [turn("early text")] }));
    applyTranscriptScan(db, scanOf("a", { restart: false, from: 10, to: 20, isTemporary: true }));
    expect(turnCount(db)).toBe(0);
    expect(conversationOfRow(findConversation(db, "a") ?? {}).isTemporary).toBe(true);
  });

  it("round-trips every summary field to the wire shape", () => {
    const db = freshDb();
    const state = {
      ...{ aiTitle: "Title", cwd: "/w", gitBranch: "main", costUsd: 1.5, linesAdded: 3, linesRemoved: 1, startedAt: 100, endedAt: 200 },
      ...{ prs: [{ number: 7, url: "https://x/7", repository: "o/r" }], skills: ["s"], hookErrors: 2, userTurns: 4 },
    };
    applyTranscriptScan(db, scanOf("a", { parentId: "parent", state }));
    expect(conversationOfRow(findConversation(db, "a") ?? {})).toEqual({
      id: "a",
      agent: "claude",
      title: "Title",
      ...{ cwd: "/w", gitBranch: "main", prs: state.prs, costUsd: 1.5, linesAdded: 3, linesRemoved: 1, startedAt: 100, endedAt: 200 },
      ...{ skills: ["s"], hookErrors: 2, userTurns: 4, isSidechain: true, parentId: "parent", isTemporary: false },
    });
  });
});

describe("removeMissingTranscripts", () => {
  it("drops the rows and text of every file the walk did not see", () => {
    const db = freshDb();
    applyTranscriptScan(db, scanOf("kept", { turns: [turn("kept text")] }));
    applyTranscriptScan(db, scanOf("gone", { turns: [turn("gone text")] }));
    expect(removeMissingTranscripts(db, new Set(["/p/kept.jsonl"]))).toBe(1);
    expect(listConversations(db, {}, 0, 10).map((row) => row.id)).toEqual(["kept"]);
    expect(readFileMark(db, "/p/gone.jsonl")).toBeNull();
    expect(turnCount(db)).toBe(1);
  });
});

describe("the lease", () => {
  it("goes to one owner at a time until it expires or is finished", () => {
    const db = freshDb();
    expect(takeLease(db, "one", 1000, 100)).toBe(true);
    expect(takeLease(db, "two", 1050, 100)).toBe(false);
    expect(takeLease(db, "one", 1050, 100)).toBe(true); // renewing
    expect(takeLease(db, "two", 1200, 100)).toBe(true); // expired at 1150
    recordProgress(db, "one", 5, 9); // no longer the owner: ignored
    recordProgress(db, "two", 3, 9);
    finishLease(db, "two", 1300);
    expect(readLease(db)).toEqual({ owner: null, expiresMs: null, filesDone: 3, filesTotal: 9, finishedMs: 1300 });
    expect(takeLease(db, "three", 1301, 100)).toBe(true);
  });
});

describe("listConversations and searchLibrary", () => {
  const seeded = (): DatabaseSync => {
    const db = freshDb();
    applyTranscriptScan(db, scanOf("old", { state: { aiTitle: "Old one", cwd: "/w", endedAt: 1 }, turns: [turn("字幕を動画に焼き込む")] }));
    applyTranscriptScan(db, scanOf("new", { state: { aiTitle: "Worktree cleanup", cwd: "/v", endedAt: 3 }, turns: [turn("prune 100% of it", "assistant")] }));
    applyTranscriptScan(db, scanOf("tmp", { isTemporary: true, state: { aiTitle: "fixture", cwd: "/tmp/x", endedAt: 5 } }));
    applyTranscriptScan(db, scanOf("sub", { parentId: "new", state: { aiTitle: "subagent work", endedAt: 4 }, turns: [turn("字幕 subagent")] }));
    return db;
  };

  it("lists newest first, leaving out temporary and subagent conversations unless asked", () => {
    const db = seeded();
    expect(listConversations(db, {}, 0, 10).map((row) => row.id)).toEqual(["new", "old"]);
    expect(listConversations(db, { includeTemporary: true, includeSidechains: true }, 0, 10).map((row) => row.id)).toEqual(["tmp", "sub", "new", "old"]);
    expect(listConversations(db, { cwd: "/w" }, 0, 10).map((row) => row.id)).toEqual(["old"]);
    expect(listConversations(db, {}, 1, 1).map((row) => row.id)).toEqual(["old"]);
  });

  it("finds Japanese text inside a word, and short queries by scanning", () => {
    const db = seeded();
    expect(searchLibrary(db, "焼き込", {}, 10).map((hit) => hit.conversation.id)).toEqual(["old"]);
    expect(searchLibrary(db, "字幕", {}, 10).map((hit) => hit.conversation.id)).toEqual(["old"]);
    expect(searchLibrary(db, "字幕", { includeSidechains: true }, 10).map((hit) => hit.conversation.id)).toEqual(["sub", "old"]);
  });

  it("matches without case, as typed, and answers the snippet and role", () => {
    const db = seeded();
    const [hit] = searchLibrary(db, "PRUNE", {}, 10);
    expect(hit).toMatchObject({ conversation: { id: "new" }, snippet: "prune 100% of it", role: "assistant" });
    expect(searchLibrary(db, "100%", {}, 10).map((h) => h.conversation.id)).toEqual(["new"]);
    expect(searchLibrary(db, "0%", {}, 10).map((h) => h.conversation.id)).toEqual(["new"]);
    expect(searchLibrary(db, "%", {}, 10).map((h) => h.conversation.id)).toEqual(["new"]);
    expect(searchLibrary(db, '"', {}, 10)).toEqual([]);
    expect(searchLibrary(db, 'it" OR "x', {}, 10)).toEqual([]);
  });

  it("finds a conversation by its title alone, with no snippet", () => {
    expect(searchLibrary(seeded(), "cleanup", {}, 10)).toEqual([expect.objectContaining({ snippet: null, role: null })]);
  });

  it("follows a rename in the title index, for long and short queries", () => {
    const db = seeded();
    applyTranscriptScan(db, scanOf("new", { restart: false, from: 10, to: 20, state: { aiTitle: "Renamed branch work", endedAt: 3 } }));
    expect(searchLibrary(db, "Worktree", {}, 10)).toEqual([]);
    expect(searchLibrary(db, "branch work", {}, 10).map((hit) => hit.conversation.id)).toEqual(["new"]);
    expect(searchLibrary(db, "Re", {}, 10).map((hit) => hit.conversation.id)).toEqual(["new"]);
  });

  it("shows the matching turn, not the title, when both match", () => {
    const db = freshDb();
    applyTranscriptScan(db, scanOf("a", { state: { aiTitle: "needle title" }, turns: [turn("the needle in text")] }));
    expect(searchLibrary(db, "needle", {}, 10)).toEqual([expect.objectContaining({ snippet: "the needle in text", role: "user" })]);
  });

  it("never finds a temporary conversation, and answers nothing for a blank query", () => {
    const db = seeded();
    expect(searchLibrary(db, "fixture", {}, 10)).toEqual([]);
    expect(searchLibrary(db, "   ", {}, 10)).toEqual([]);
  });

  it("answers one hit per conversation, up to the limit", () => {
    const db = freshDb();
    applyTranscriptScan(db, scanOf("a", { state: { endedAt: 1 }, turns: [turn("needle one"), turn("needle two")] }));
    applyTranscriptScan(db, scanOf("b", { state: { endedAt: 2 }, turns: [turn("needle three")] }));
    expect(searchLibrary(db, "needle", {}, 10).map((hit) => hit.conversation.id)).toEqual(["b", "a"]);
    expect(searchLibrary(db, "needle", {}, 1).map((hit) => hit.conversation.id)).toEqual(["b"]);
  });
});
