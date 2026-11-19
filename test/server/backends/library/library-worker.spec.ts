// @vitest-environment node
// The Library's worker thread (#3328): a real worker, over files in a temp dir — it answers, it
// builds the index in the background, and a call it cannot answer is an error rather than a hang.
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Worker } from "node:worker_threads";
import path from "node:path";
import { createLibraryClient } from "../../../../server/backends/library/library-client";
import { dispatchLibraryRequest, filterArg, isLibraryRequest } from "../../../../server/backends/library/library-dispatch";
import type { LibraryService } from "../../../../server/backends/library/library-service";
import { isRecord } from "../../../../common/isRecord";

const cleanups: (() => Promise<void> | void)[] = [];
// Newest first: the worker holds the database open, and Windows will not remove a directory with an
// open file in it, so the client registered after its directory must close before the directory goes.
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), "mt-library-worker-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const projectsRoot = path.join(root, "projects");
  mkdirSync(path.join(projectsRoot, "-w"), { recursive: true });
  return { root, projectsRoot, historyFile: path.join(root, "history.jsonl") };
}

const filesDone = (status: unknown): number => (isRecord(status) && typeof status.filesDone === "number" ? status.filesDone : -1);

describe("the library worker", () => {
  it("builds the index in the background and answers from it", async () => {
    const { root, projectsRoot, historyFile } = scratch();
    const record = { type: "user", cwd: "/w", timestamp: "2026-11-18T08:00:00.000Z", message: { content: "from the worker" } };
    writeFileSync(path.join(projectsRoot, "-w", "s1.jsonl"), `${JSON.stringify(record)}\n`);
    const client = createLibraryClient({ file: path.join(root, "index.db"), sources: { projectsRoot, historyFile } });
    cleanups.push(() => client.close());
    await client.call("status", []);
    await expect.poll(async () => filesDone(await client.call("status", [])), { timeout: 15_000 }).toBe(1);
    const hits = await client.call("search", ["the worker", {}, 10]);
    expect(Array.isArray(hits) && hits.length).toBe(1);
    expect(await client.call("conversation", ["absent"])).toBeNull();
  }, 30_000);

  // Two servers opening the Library at the same moment on one new index file. A smoke test: threads in
  // one process rarely collide the way two server processes did, so the open retry itself was checked
  // by racing two processes, not here.
  it("lets two workers open and share the same new index", async () => {
    const { root, projectsRoot, historyFile } = scratch();
    const file = path.join(root, "index.db");
    const clients = [1, 2].map(() => createLibraryClient({ file, sources: { projectsRoot, historyFile } }));
    clients.forEach((client) => cleanups.push(() => client.close()));
    const statuses = await Promise.all(clients.map((client) => client.call("status", [])));
    expect(statuses.every(isRecord)).toBe(true);
  }, 30_000);

  it("answers on a new worker even while the old one is still exiting", async () => {
    const { root, projectsRoot, historyFile } = scratch();
    const client = createLibraryClient({ file: path.join(root, "index.db"), sources: { projectsRoot, historyFile } });
    cleanups.push(() => client.close());
    await client.call("status", []);
    const closing = client.close();
    // Starts a second worker before the first one's `exit` has arrived; that event must not reach it.
    const answer = client.call("status", []);
    await closing;
    await expect(answer).resolves.toSatisfy(isRecord);
  }, 30_000);

  it("retires a worker that does not answer in time, and starts a fresh one for the next call", async () => {
    const { root, projectsRoot, historyFile } = scratch();
    const started: Worker[] = [];
    // Too short for any answer: every call times out, which is the case under test.
    const client = createLibraryClient({
      file: path.join(root, "index.db"),
      sources: { projectsRoot, historyFile },
      timeout_ms: 1,
      onStart: (w) => started.push(w),
    });
    cleanups.push(() => client.close());
    const call = client.call("status", []);
    const exited = new Promise((resolve) => started[0]?.once("exit", resolve));
    await expect(call).rejects.toThrow("timed out");
    await exited;
    await expect(client.call("status", [])).rejects.toThrow("timed out");
    expect(started).toHaveLength(2);
  }, 30_000);

  it("fails a call that is still waiting when the client closes", async () => {
    const { root, projectsRoot, historyFile } = scratch();
    const client = createLibraryClient({ file: path.join(root, "index.db"), sources: { projectsRoot, historyFile } });
    // The expectation is attached before closing: `close()` rejects the call at once, and a rejection
    // with no handler yet is reported as unhandled even though the test goes on to check it.
    const outcome = expect(client.call("status", [])).rejects.toThrow("closed");
    await client.close();
    await outcome;
  }, 30_000);

  it("rejects a call when the index cannot be opened", async () => {
    const { root, projectsRoot, historyFile } = scratch();
    // A directory where the database file should be: SQLite cannot open it.
    const file = path.join(root, "index.db");
    mkdirSync(file);
    const client = createLibraryClient({ file, sources: { projectsRoot, historyFile } });
    cleanups.push(() => client.close());
    await expect(client.call("status", [])).rejects.toThrow();
  }, 30_000);
});

describe("dispatchLibraryRequest", () => {
  const calls: unknown[][] = [];
  const service: LibraryService = {
    status: () => (calls.push(["status"]), Promise.resolve({ indexing: false, filesDone: 0, filesTotal: 0, finishedAt: null })),
    list: (...args) => (calls.push(["list", ...args]), Promise.resolve({ conversations: [], hasMore: false })),
    conversation: (...args) => (calls.push(["conversation", ...args]), Promise.resolve(null)),
    search: (...args) => (calls.push(["search", ...args]), Promise.resolve([])),
  };

  it("passes well-formed arguments through, and replaces malformed ones with safe values", async () => {
    calls.length = 0;
    await dispatchLibraryRequest(service, { id: "1", method: "list", args: [{ cwd: "/w", includeTemporary: true }, 5, 10] });
    await dispatchLibraryRequest(service, { id: "2", method: "list", args: ["nonsense", -1, 2.5] });
    await dispatchLibraryRequest(service, { id: "3", method: "search", args: [42, null] });
    await dispatchLibraryRequest(service, { id: "4", method: "conversation", args: [] });
    expect(calls).toEqual([
      ["list", { cwd: "/w", includeTemporary: true, includeSidechains: false }, 5, 10],
      ["list", {}, 0, 0],
      ["search", "", {}, 0],
      ["conversation", ""],
    ]);
  });

  it("recognises only a request it can answer", () => {
    expect(isLibraryRequest({ id: "1", method: "status", args: [] })).toBe(true);
    expect(isLibraryRequest({ id: "1", method: "drop", args: [] })).toBe(false);
    expect(isLibraryRequest({ id: 1, method: "status", args: [] })).toBe(false);
    expect(isLibraryRequest({ id: "1", method: "status" })).toBe(false);
    expect(isLibraryRequest(null)).toBe(false);
  });

  it("reads a filter only from the fields it knows", () => {
    expect(filterArg({ cwd: 3, includeTemporary: "yes", includeSidechains: true, extra: 1 })).toEqual({ includeTemporary: false, includeSidechains: true });
  });
});
