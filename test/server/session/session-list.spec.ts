import { describe, it, expect } from "vitest";
import { parseActivityIds, selectSessionRows, type SessionRow } from "../../../server/session/session-list.js";

const never = () => false;
const disk = (id: string, mtime: number): SessionRow => ({ kind: "disk", id, file: `${id}.jsonl`, mtime });
const pending = (id: string, mtime: number): SessionRow => ({
  kind: "pending",
  id,
  title: id,
  mtime,
  working: false,
  waiting: false,
  event: null,
  hidden: false,
});
const ids = (rows: SessionRow[]) => rows.map((r) => r.id);
const filter = (over: Partial<Parameters<typeof selectSessionRows>[1]> = {}) => ({
  isTranslationWorker: never,
  isDevTerminal: never,
  includePending: true,
  limit: 50,
  ...over,
});

describe("selectSessionRows", () => {
  it("orders newest first, whatever order they arrive in", () => {
    expect(ids(selectSessionRows([disk("old", 1), disk("new", 3), disk("mid", 2)], filter()))).toEqual(["new", "mid", "old"]);
  });

  it("interleaves pending rows with on-disk ones by recency", () => {
    expect(ids(selectSessionRows([disk("a", 1), pending("b", 3), disk("c", 2)], filter()))).toEqual(["b", "c", "a"]);
  });

  it("drops translation workers — they are internal helpers, not chats", () => {
    const rows = [disk("keep", 2), disk("worker", 3)];
    expect(ids(selectSessionRows(rows, filter({ isTranslationWorker: (id) => id === "worker" })))).toEqual(["keep"]);
  });

  // The rule with history: hiding grid sessions from the CHAT sidebar must not hide them
  // from the grid's OWN cwd-scoped resume picker, or they stop being resumable there.
  it("hides grid sessions from the unscoped chat listing", () => {
    const rows = [disk("chat", 2), disk("grid", 3)];
    expect(ids(selectSessionRows(rows, filter({ isDevTerminal: (id) => id === "grid", includePending: true })))).toEqual(["chat"]);
  });

  it("keeps grid sessions in a cwd-scoped listing (the grid's own resume picker)", () => {
    const rows = [disk("chat", 2), disk("grid", 3)];
    expect(ids(selectSessionRows(rows, filter({ isDevTerminal: (id) => id === "grid", includePending: false })))).toEqual(["grid", "chat"]);
  });

  it("caps the listing, keeping the newest", () => {
    const rows = [disk("a", 1), disk("b", 2), disk("c", 3)];
    expect(ids(selectSessionRows(rows, filter({ limit: 2 })))).toEqual(["c", "b"]);
  });

  it("keeps exactly `limit` rows at the boundary", () => {
    const rows = [disk("a", 1), disk("b", 2)];
    expect(selectSessionRows(rows, filter({ limit: 2 }))).toHaveLength(2);
  });

  it("returns nothing for a zero limit", () => {
    expect(selectSessionRows([disk("a", 1)], filter({ limit: 0 }))).toEqual([]);
  });

  it("returns nothing for no rows", () => {
    expect(selectSessionRows([], filter())).toEqual([]);
  });

  it("filters before capping, so a hidden row cannot consume a slot", () => {
    const rows = [disk("worker", 9), disk("a", 2), disk("b", 1)];
    expect(ids(selectSessionRows(rows, filter({ isTranslationWorker: (id) => id === "worker", limit: 2 })))).toEqual(["a", "b"]);
  });

  it("does not mutate the caller's array", () => {
    const rows = [disk("a", 1), disk("b", 3)];
    selectSessionRows(rows, filter());
    expect(ids(rows)).toEqual(["a", "b"]);
  });
});

describe("parseActivityIds", () => {
  const uuidish = (id: string) => id.startsWith("id-");

  it("keeps the well-formed ids", () => {
    expect(parseActivityIds("id-1,id-2", uuidish, 10)).toEqual(["id-1", "id-2"]);
  });

  it("drops ids that fail validation", () => {
    expect(parseActivityIds("id-1,../evil,id-2", uuidish, 10)).toEqual(["id-1", "id-2"]);
  });

  it("caps the count so the query string stays bounded", () => {
    expect(parseActivityIds("id-1,id-2,id-3", uuidish, 2)).toEqual(["id-1", "id-2"]);
  });

  it("returns none for an empty query", () => {
    expect(parseActivityIds("", uuidish, 10)).toEqual([]);
  });

  // Express gives an array when a param repeats (?ids=a&ids=b), and undefined when absent.
  it("returns none for a non-string query", () => {
    expect(parseActivityIds(["id-1", "id-2"], uuidish, 10)).toEqual([]);
    expect(parseActivityIds(undefined, uuidish, 10)).toEqual([]);
    expect(parseActivityIds(null, uuidish, 10)).toEqual([]);
  });

  it("returns none when nothing validates", () => {
    expect(parseActivityIds("nope,also-nope", uuidish, 10)).toEqual([]);
  });
});
