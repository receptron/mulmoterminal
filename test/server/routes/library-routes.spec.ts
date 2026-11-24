// @vitest-environment node
// /api/library/* (#3328): the index over HTTP, on an in-memory index — paging, one conversation,
// search's limits, and the answer when the index cannot be opened.
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { routeCall } from "../../helpers/routeCall";
import { PR_CREATORS_MAX } from "../../../common/library";
import { filterOf, isMarkableId, markChangeOf, mountLibraryRoutes, prNumbersOf, queryCount } from "../../../server/routes/library-routes";
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
      replies: [],
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

describe("prNumbersOf", () => {
  it.each([
    ["1,2,3", [1, 2, 3]],
    ["7,7", [7]],
    ["", null],
    ["0", null],
    ["-1", null],
    ["1,,2", null],
    ["1.5", null],
    ["01", null],
    ["12345678901", null],
    [undefined, null],
    [["1"], null],
  ])("%j → %j", (value, expected) => {
    expect(prNumbersOf(value)).toEqual(expected);
  });

  it("refuses more numbers than one lookup may ask about", () => {
    const many = Array.from({ length: PR_CREATORS_MAX + 1 }, (_, i) => String(i + 1));
    expect(prNumbersOf(many.slice(0, PR_CREATORS_MAX).join(","))).toHaveLength(PR_CREATORS_MAX);
    expect(prNumbersOf(many.join(","))).toBeNull();
  });
});

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

  it("answers how often each skill ran, and 503 when the index cannot", async () => {
    const usage = [{ id: "publish", conversations: 2, lastUsedAt: 5 }];
    const app = express();
    mountLibraryRoutes(app, { call: (method) => (method === "skillUsage" ? Promise.resolve(usage) : Promise.reject(new Error("unexpected"))) });
    expect((await routeCall(app)("/api/library/skill-usage")).body).toEqual({ skills: usage });
    const down = express();
    mountLibraryRoutes(down, { call: () => Promise.reject(new Error("the library index is unavailable")) });
    expect((await routeCall(down)("/api/library/skill-usage")).status).toBe(503);
  });

  it("answers one conversation, or 404", async () => {
    const call = appWithConversations(1);
    expect((await call("/api/library/conversations/s0")).body).toMatchObject({ id: "s0", title: "title 0" });
    expect((await call("/api/library/conversations/nope")).status).toBe(404);
  });

  it("answers the creators of the PRs asked about, and refuses a malformed repository or number list", async () => {
    const asked: unknown[][] = [];
    const app = express();
    mountLibraryRoutes(app, { call: (method, args) => (asked.push([method, ...args]), Promise.resolve([])) });
    const call = routeCall(app);
    expect((await call("/api/library/pr-creators?repo=receptron%2Fmulmoterminal&numbers=3340,3341,3340")).body).toEqual({ creators: [] });
    const bad = [
      "repo=receptron&numbers=1",
      "repo=a%2Fb%2Fc&numbers=1",
      "repo=..%2Fx&numbers=1",
      "repo=gitlab.com%2Fg%2Fp&numbers=1",
      "repo=o%2Fr",
      "repo=o%2Fr&numbers=",
    ];
    for (const query of bad) expect((await call(`/api/library/pr-creators?${query}`)).status, query).toBe(400);
    expect(asked).toEqual([["prCreators", "receptron/mulmoterminal", [3340, 3341]]]);
  });

  it("passes the project a conversation is asked for in, so a session copied into two picks its own", async () => {
    const asked: unknown[][] = [];
    const app = express();
    mountLibraryRoutes(app, { call: (method, args) => (asked.push([method, ...args]), Promise.resolve(null)) });
    const call = routeCall(app);
    await call("/api/library/conversations/s1?cwd=%2Fw%2Fapp");
    await call("/api/library/conversations/s1");
    expect(asked).toEqual([
      ["conversation", "s1", "/w/app"],
      ["conversation", "s1", ""],
    ]);
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
    // The index holds one conversation; any other id is not found.
    const known = "0f6a7c2e-1b2c-4d3e-8f90-123456789abc";
    mountLibraryRoutes(app, {
      call: (method, args) => Promise.resolve(method === "conversation" && args[0] === known ? { id: known } : null),
      marksFile: path.join(dir, "marks.json"),
    });
    return routeCall(app);
  };

  it("saves a pin and a name, and reads them back", async () => {
    const call = appWithMarks();
    expect((await call("/api/library/marks")).body).toEqual({ pinned: [], names: {} });
    await call("/api/library/marks/0f6a7c2e-1b2c-4d3e-8f90-123456789abc", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    const saved = await call("/api/library/marks/0f6a7c2e-1b2c-4d3e-8f90-123456789abc", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Mine" }),
    });
    expect(saved.body).toEqual({ pinned: ["0f6a7c2e-1b2c-4d3e-8f90-123456789abc"], names: { "0f6a7c2e-1b2c-4d3e-8f90-123456789abc": "Mine" } });
  });

  it.each([
    ["an empty body", "{}", "0f6a7c2e-1b2c-4d3e-8f90-123456789abc"],
    ["a wrong-typed field", JSON.stringify({ pinned: "yes" }), "0f6a7c2e-1b2c-4d3e-8f90-123456789abc"],
    ["an id that is not path-safe", JSON.stringify({ pinned: true }), "..%2Fetc"],
  ])("refuses %s", async (_label, body, id) => {
    const call = appWithMarks();
    expect((await call(`/api/library/marks/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body })).status).toBe(400);
  });
});

describe("PUT /api/library/marks/:id for a conversation the index does not hold", () => {
  it("answers 404 and writes nothing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-library-marks-unknown-"));
    try {
      const app = express();
      app.use(express.json());
      mountLibraryRoutes(app, { call: () => Promise.resolve(null), marksFile: path.join(dir, "marks.json") });
      const call = routeCall(app);
      const answer = await call("/api/library/marks/agent-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      });
      expect(answer.status).toBe(404);
      expect((await call("/api/library/marks")).body).toEqual({ pinned: [], names: {} });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

describe("/api/library/marks failures", () => {
  it("answers a fixed message, not one naming the file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-library-marks-bad-"));
    try {
      const file = path.join(dir, "marks.json");
      writeFileSync(file, "{ not json");
      const app = express();
      app.use(express.json());
      mountLibraryRoutes(app, { call: () => Promise.resolve(null), marksFile: file });
      const answer = await routeCall(app)("/api/library/marks");
      expect(answer.status).toBe(500);
      expect(answer.text).not.toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isMarkableId", () => {
  it.each([
    ["0f6a7c2e-1b2c-4d3e-8f90-123456789abc", true],
    ["agent-a1b2c3d4e5f60718", true],
    ["agent-1", true],
    ["--resume", false],
    ["../marks", false],
    ["a/b", false],
    ["", false],
  ])("%s → %s", (id, expected) => {
    expect(isMarkableId(id)).toBe(expected);
  });
});
