// @vitest-environment node
import { describe, it, expect } from "vitest";

import { applySessionMemo, createMemoWriteGuard, sessionMemoLine, sessionMemoRecord } from "../../../server/session/session-memos.js";
import { MEMO_MAX_LENGTH } from "../../../common/sessionMemo.js";

const VALID_ID = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";
const isValidId = (id: string) => id === VALID_ID || id === "another-id";

// What hydration does: parse each line, keep the last word on each id.
const memosFrom = (lines: string[]): Map<string, string> => {
  const memos = new Map<string, string>();
  lines.forEach((line) => {
    const record = sessionMemoRecord(JSON.parse(line), isValidId);
    if (record) applySessionMemo(memos, record);
  });
  return memos;
};

describe("sessionMemoLine", () => {
  it("writes one JSON object per line", () => {
    const line = sessionMemoLine(VALID_ID, "release check", 1000);
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({ id: VALID_ID, text: "release check", at: 1000 });
  });

  // JSON rather than the id log's `<id> <value>`: a memo is free text, and a user pasting a quote
  // or a Windows path must not be able to shape the file.
  it("survives a round trip through quotes, backslashes and multi-byte text", () => {
    const text = 'branch "fix/1084" — C:\\repo の検証';
    expect(memosFrom([sessionMemoLine(VALID_ID, text, 1)]).get(VALID_ID)).toBe(text);
  });
});

describe("hydrating a memo log", () => {
  it("takes the newest line for an id", () => {
    const memos = memosFrom([sessionMemoLine(VALID_ID, "first", 1), sessionMemoLine(VALID_ID, "second", 2)]);
    expect(memos.get(VALID_ID)).toBe("second");
  });

  // THE reason this is an append log rather than a rewritten snapshot: an erase is a line, so two
  // instances writing at once cannot lose each other's edits.
  it("erases on an empty text", () => {
    const memos = memosFrom([sessionMemoLine(VALID_ID, "written", 1), sessionMemoLine(VALID_ID, "", 2)]);
    expect(memos.has(VALID_ID)).toBe(false);
  });

  it("lets a memo written after an erase come back", () => {
    const memos = memosFrom([sessionMemoLine(VALID_ID, "first", 1), sessionMemoLine(VALID_ID, "", 2), sessionMemoLine(VALID_ID, "again", 3)]);
    expect(memos.get(VALID_ID)).toBe("again");
  });

  it("keeps the ids apart", () => {
    const memos = memosFrom([sessionMemoLine(VALID_ID, "mine", 1), sessionMemoLine("another-id", "theirs", 2)]);
    expect([memos.get(VALID_ID), memos.get("another-id")]).toEqual(["mine", "theirs"]);
  });
});

describe("sessionMemoRecord", () => {
  it("drops a line whose id is not a session id — these become map keys", () => {
    expect(sessionMemoRecord({ id: "../../etc/passwd", text: "x" }, isValidId)).toBeNull();
    expect(sessionMemoRecord({ text: "x" }, isValidId)).toBeNull();
    expect(sessionMemoRecord({ id: 42, text: "x" }, isValidId)).toBeNull();
  });

  it("drops a line whose text is not a string", () => {
    expect(sessionMemoRecord({ id: VALID_ID }, isValidId)).toBeNull();
    expect(sessionMemoRecord({ id: VALID_ID, text: { note: "x" } }, isValidId)).toBeNull();
  });

  // Normalized on the way IN as well as out: a line hand-edited into the file, or written by a
  // build whose cap was longer, must not put a two-line memo in a one-line header.
  it("normalizes what it reads back", () => {
    expect(sessionMemoRecord({ id: VALID_ID, text: "two\nlines" }, isValidId)?.text).toBe("two lines");
    expect(sessionMemoRecord({ id: VALID_ID, text: "x".repeat(MEMO_MAX_LENGTH + 10) }, isValidId)?.text).toHaveLength(MEMO_MAX_LENGTH);
  });

  // A whitespace-only line normalizes to the erase value, so it must ERASE rather than store " ".
  it("treats a whitespace-only line as an erase", () => {
    const memos = memosFrom([sessionMemoLine(VALID_ID, "written", 1), JSON.stringify({ id: VALID_ID, text: "   ", at: 2 })]);
    expect(memos.has(VALID_ID)).toBe(false);
  });
});

// Which write may undo the in-memory memo when its disk append fails.
describe("createMemoWriteGuard", () => {
  it("lets a write roll back while nothing has replaced it", () => {
    const guard = createMemoWriteGuard();
    const ticket = guard.begin(VALID_ID);
    expect(guard.isLatest(VALID_ID, ticket)).toBe(true);
  });

  // THE contract, and the reason this is recency rather than value equality: two overlapping
  // writes can carry the SAME text, so "the map still holds what I put there" is true for a write
  // that has already been superseded. A rollback on that leaves this process serving the old note
  // while the disk holds the new one, until a restart.
  it("stops a superseded write from rolling back over the one that replaced it", () => {
    const guard = createMemoWriteGuard();
    const first = guard.begin(VALID_ID);
    const second = guard.begin(VALID_ID);
    expect(guard.isLatest(VALID_ID, first)).toBe(false);
    expect(guard.isLatest(VALID_ID, second)).toBe(true);
  });

  it("keeps the sessions independent — a write elsewhere does not supersede this one", () => {
    const guard = createMemoWriteGuard();
    const mine = guard.begin(VALID_ID);
    guard.begin("another-id");
    expect(guard.isLatest(VALID_ID, mine)).toBe(true);
  });

  it("knows nothing about a session that has never been written", () => {
    const guard = createMemoWriteGuard();
    expect(guard.isLatest(VALID_ID, 1)).toBe(false);
  });
});
