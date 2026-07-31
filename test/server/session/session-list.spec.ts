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
  failed: false,
});
const ids = (rows: SessionRow[]) => rows.map((r) => r.id);
const filter = (over: Partial<Parameters<typeof selectSessionRows>[1]> = {}) => ({
  isInternalHelper: never,
  isDevTerminal: never,
  isBackground: never,
  includePending: true,
  limit: 50,
  backgroundLimit: 10,
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
    expect(ids(selectSessionRows(rows, filter({ isInternalHelper: (id) => id === "worker" })))).toEqual(["keep"]);
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
    expect(ids(selectSessionRows(rows, filter({ isInternalHelper: (id) => id === "worker", limit: 2 })))).toEqual(["a", "b"]);
  });

  // Background workers are LISTED — the client puts them behind a chip. Dropping them here
  // would take away the only way to open one, and a MulmoTerminal session is a live
  // terminal: a row you cannot reach is a process you cannot stop (#1060).
  it("keeps background rows, in recency order with the chats", () => {
    const rows = [disk("chat", 2), disk("refresh", 3)];
    expect(ids(selectSessionRows(rows, filter({ isBackground: (id) => id === "refresh" })))).toEqual(["refresh", "chat"]);
  });

  // The rule that pays for the separate cap: the client hides background rows by default, so
  // under one shared cap a busy refresh schedule empties the chat list and the screen just
  // looks like a project with no history.
  it("does not let background rows consume the chat cap", () => {
    const rows = [disk("bg1", 9), disk("bg2", 8), disk("a", 2), disk("b", 1)];
    const isBackground = (id: string) => id.startsWith("bg");
    expect(ids(selectSessionRows(rows, filter({ isBackground, limit: 2 })))).toEqual(["bg1", "bg2", "a", "b"]);
  });

  it("caps background rows on their own limit, keeping the newest", () => {
    const rows = [disk("bg1", 9), disk("bg2", 8), disk("bg3", 7), disk("a", 1)];
    const isBackground = (id: string) => id.startsWith("bg");
    expect(ids(selectSessionRows(rows, filter({ isBackground, backgroundLimit: 2 })))).toEqual(["bg1", "bg2", "a"]);
  });

  it("lists no background rows at a zero background limit, and keeps the chats", () => {
    const rows = [disk("bg", 9), disk("a", 1)];
    expect(ids(selectSessionRows(rows, filter({ isBackground: (id) => id === "bg", backgroundLimit: 0 })))).toEqual(["a"]);
  });

  // Both exclusions apply to the same row set: a grid session that is also a background
  // worker is still a grid session, and the chat listing must not get it back through the
  // background bucket.
  it("still hides a grid session from chat when it is also a background worker", () => {
    const rows = [disk("chat", 1), disk("grid", 3)];
    const only = { isDevTerminal: (id: string) => id === "grid", isBackground: (id: string) => id === "grid" };
    expect(ids(selectSessionRows(rows, filter(only)))).toEqual(["chat"]);
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
