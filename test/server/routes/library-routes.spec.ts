// @vitest-environment node
// /api/library/* (#3328): the index over HTTP, on an in-memory index — paging, one conversation,
// search's limits, and the answer when the index cannot be opened.
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { routeCall } from "../../helpers/routeCall";
import { filterOf, markChangeOf, mountLibraryRoutes, queryCount } from "../../../server/routes/library-routes";
import { applyTranscriptScan, finishLease, prepareLibraryStore, takeLease } from "../../../server/backends/library/index-store";
import { createLibraryIndex } from "../../../server/backends/library/library-index";
import { createLocalLibraryService } from "../../../server/backends/library/library-service";
import { localLibraryCaller } from "../../../server/backends/library/library-dispatch";
import { emptyConversationState } from "../../../server/backends/library/conversation-fold";

function appWithConversations(count: number) {
  const db = new DatabaseSync(":memory:");
  prepareLibraryStore(db);
  takeLease(db, "t", 0, Number.MAX_SAFE_INTEGER);
  Array.from({ length: count }, (_, i) => i).forEach((i) =>
    applyTranscriptScan(db, {
      ...{ path: `/p/s${String(i)}.jsonl`, id: `s${String(i)}`, agent: "claude", parentId: null, isTemporary: false },
      ...{ stamp: { size: 1, mtimeMs: 1 }, head: "h", owner: "t", expectedScannedTo: null, to: 1, restart: true },
      state: { ...emptyConversationState(), aiTitle: `title ${String(i)}`, endedAt: i },
      turns: [{ role: "user", text: `needle number ${String(i)}`, at: null }],
    }),
  );
  finishLease(db, "t", 0);
  // Nothing on disk to walk: a refresh would look at the real home, so this index never runs one.
  const index = {
    ...createLibraryIndex(db, { projectsRoot: "/absent", historyFile: "/absent", temporaryRoots: [], owner: "t", now_ms: () => 0 }),
    refresh: () => {},
  };
  const app = express();
  mountLibraryRoutes(app, { call: localLibraryCaller(createLocalLibraryService(index)) });
  return routeCall(app);
}

describe("/api/library", () => {
  it("pages the list, newest first, and says when there is more", async () => {
    const call = appWithConversations(3);
    const first = (await call("/api/library/conversations?limit=2")).body;
    expect((first.conversations as { id: string }[]).map((c) => c.id)).toEqual(["s2", "s1"]);
    expect(first.hasMore).toBe(true);
    const second = (await call("/api/library/conversations?limit=2&offset=2")).body;
    expect((second.conversations as { id: string }[]).map((c) => c.id)).toEqual(["s0"]);
    expect(second.hasMore).toBe(false);
    expect(second.indexFinishedAt).toBe(0); // the pass this page reflects, which the screen compares with the status
  });

  it("answers one conversation, or 404", async () => {
    const call = appWithConversations(1);
    expect((await call("/api/library/conversations/s0")).body).toMatchObject({ id: "s0", title: "title 0" });
    expect((await call("/api/library/conversations/nope")).status).toBe(404);
  });

  it("searches, and refuses an empty or overlong query", async () => {
    const call = appWithConversations(2);
    const found = (await call(`/api/library/search?q=${encodeURIComponent("number 1")}`)).body;
    expect((found.hits as { conversation: { id: string } }[]).map((hit) => hit.conversation.id)).toEqual(["s1"]);
    expect((await call("/api/library/search?q=")).status).toBe(400);
    expect((await call(`/api/library/search?q=${"x".repeat(201)}`)).status).toBe(400);
  });

  it("reports progress", async () => {
    expect((await appWithConversations(0)("/api/library/status")).body).toEqual({ indexing: false, filesDone: 0, filesTotal: 0, finishedAt: 0 });
  });

  it("answers 503 when the index cannot be opened or does not answer", async () => {
    const app = express();
    mountLibraryRoutes(app, { call: () => Promise.reject(new Error("the library worker exited")) });
    expect((await routeCall(app)("/api/library/status")).status).toBe(503);
  });
});

describe("query parsing", () => {
  it.each([
    [undefined, 50],
    ["10", 10],
    ["999", 200],
    ["-1", 50],
    ["1.5", 50],
    ["abc", 50],
    [["1", "2"], 50],
  ])("limit %j → %d", (value, expected) => {
    expect(queryCount(value, 50, 200)).toBe(expected);
  });

  it("reads the filter flags, and ignores an empty cwd", () => {
    expect(filterOf({})).toEqual({ includeTemporary: false, includeSidechains: false, includeAutomated: false });
    expect(filterOf({ cwd: "/w", temporary: "1", sidechains: "true", automated: "1" })).toEqual({
      cwd: "/w",
      includeTemporary: true,
      includeSidechains: true,
      includeAutomated: true,
    });
    expect(filterOf({ cwd: "", temporary: "yes" })).toEqual({ includeTemporary: false, includeSidechains: false, includeAutomated: false });
  });
});

describe("/api/library/marks", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const appWithMarks = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-library-marks-route-"));
    dirs.push(dir);
    const app = express();
    app.use(express.json());
    mountLibraryRoutes(app, { call: () => Promise.resolve(null), marksFile: path.join(dir, "marks.json") });
    return routeCall(app);
  };

  it("saves a pin and a name, and reads them back", async () => {
    const call = appWithMarks();
    expect((await call("/api/library/marks")).body).toEqual({ pinned: [], names: {} });
    await call("/api/library/marks/abc-1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ pinned: true }) });
    const saved = await call("/api/library/marks/abc-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Mine" }),
    });
    expect(saved.body).toEqual({ pinned: ["abc-1"], names: { "abc-1": "Mine" } });
  });

  it.each([
    ["an empty body", "{}", "abc"],
    ["a wrong-typed field", JSON.stringify({ pinned: "yes" }), "abc"],
    ["an id that is not a session id", JSON.stringify({ pinned: true }), "..%2Fetc"],
  ])("refuses %s", async (_label, body, id) => {
    const call = appWithMarks();
    expect((await call(`/api/library/marks/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body })).status).toBe(400);
  });
});

describe("markChangeOf", () => {
  it("keeps only fields of the right type", () => {
    expect(markChangeOf({ pinned: true, name: null, extra: 1 })).toEqual({ pinned: true, name: null });
    expect(markChangeOf({ pinned: 1, name: 3 })).toBeNull();
    expect(markChangeOf({ pinned: true, name: 42 })).toBeNull(); // one bad field refuses the whole change
    expect(markChangeOf({ name: "x".repeat(201) })).toBeNull();
    expect(markChangeOf({})).toBeNull();
  });
});
