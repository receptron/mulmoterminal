// @vitest-environment node
// That a spawn actually RECORDS the collection it was started from (#2020).
//
// The resolution has its own spec; this is the wiring around it, which is what a later change
// breaks silently. Three things have to hold together and none of them is visible in the response:
// the route reads `collection` off the body, it resolves it in the SESSION's directory (not the
// workspace), and it records under the id it is about to answer with. Get the last one wrong and
// every cell is unmarked while the log fills up with orphan lines.
//
// Recorded BEFORE the response, too: the browser reads /api/session/:id exactly once after
// placing the cell, so a record that lands afterwards is a mark nothing draws.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { routeCall, jsonPost } from "../../helpers/routeCall";

// Same reason as seeded-spawn-prompt.spec.ts: process.env is shared across a vitest worker, so
// pointing HOME at a temp dir reaches unrelated specs. What is under test is the in-memory
// decision; the log's own format has its own spec.
// Typed with the two arguments the assertions read — a bare `vi.fn(async () => …)` gives
// `mock.calls` an empty tuple type, so `call[0]` is a compile error rather than the path.
const appendFile = vi.fn<(file: string, line: string) => Promise<undefined>>(async () => undefined);
vi.mock("node:fs", () => {
  const promises = {
    readFile: vi.fn(async () => ""),
    appendFile: (file: string, line: string) => appendFile(file, line),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  const realpathSync = Object.assign(
    vi.fn((p: string) => p),
    { native: vi.fn((p: string) => p) },
  );
  return { promises, realpathSync, default: { promises, realpathSync } };
});

// The ENGINE is stubbed, not the resolver: what this spec pins is that the route asks it at all,
// with the slug the body carried and the directory the session runs in.
const asked: Array<{ slug: string | null; cwd: string }> = [];
let answer: { slug: string; icon: string; title: string } | null = null;
vi.mock("../../../server/session/spawn-collection.js", () => ({
  resolveSpawnCollection: async (slug: string | null, cwd: string) => {
    asked.push({ slug, cwd });
    return answer;
  },
}));

const { mountPluginRoutes } = await import("../../../server/routes/plugin-routes.js");
const { sessionCollections } = await import("../../../server/session/registry.js");

const app = express();
app.use(express.json());
mountPluginRoutes(app, {
  spawnClaudePty: (() => ({})) as never,
  spawnCodexPty: (() => ({})) as never,
  spawnAntigravityPty: (() => ({})) as never,
  spawnGrokPty: (() => ({})) as never,
  spawnMusePty: (() => ({})) as never,
  registerBackgroundSession: () => {},
});
const call = routeCall(app);

/** Spawn, and answer with the session id the route minted. */
async function spawn(body: Record<string, unknown>): Promise<string> {
  const res = await call("/api/plugin/spawnBackgroundChat", jsonPost({ message: "look at this", ...body }));
  const chatId = (res.body as { jsonData?: { chatId?: string } }).jsonData?.chatId;
  if (!chatId) throw new Error(`no chatId in ${JSON.stringify(res.body)}`);
  return chatId;
}

beforeEach(() => {
  asked.length = 0;
  answer = null;
  appendFile.mockClear();
  appendFile.mockImplementation(async () => undefined);
});

/** Let the append chain (mkdir -> appendFile) run. It is deliberately not awaited by the route,
 *  so a test that asserts on it has to yield rather than expect it to have happened already. */
const settleAppends = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The session-collections lines this run appended, as parsed objects. */
const appendedCollectionLines = (): Array<Record<string, unknown>> =>
  appendFile.mock.calls.filter((call) => String(call[0]).endsWith("session-collections.jsonl")).map((call) => JSON.parse(String(call[1])));

describe("recording the collection a spawn was started from", () => {
  it("records what the resolver answered, under the id it hands back", async () => {
    answer = { slug: "invoices", icon: "receipt_long", title: "Invoices" };

    const chatId = await spawn({ collection: "invoices" });

    expect(sessionCollections.get(chatId)).toEqual({ slug: "invoices", icon: "receipt_long", title: "Invoices" });
    // In the directory the session runs in — the workspace here, since no project was named.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.slug).toBe("invoices");
    expect(asked[0]?.cwd).toBeTruthy();
  });

  it("records nothing when the resolver finds no collection", async () => {
    answer = null;
    const chatId = await spawn({ collection: "deep-research" });
    expect(sessionCollections.has(chatId)).toBe(false);
  });

  // The ordinary case: every spawn that has nothing to do with collections — an agent calling the
  // tool, the Settings skill buttons, a plain chat.
  it("spawns as before when no collection is named", async () => {
    const chatId = await spawn({});
    expect(sessionCollections.has(chatId)).toBe(false);
    expect(asked[0]?.slug).toBeNull();
    await settleAppends();
    expect(appendedCollectionLines()).toEqual([]);
  });

  // The record has to reach the LOG, not only the map — the map dies with the process and the cell
  // does not (Codex round 1, P2). The line is asserted whole because it is a shared on-disk format:
  // a field renamed here is a field an older build's parser drops.
  it("appends the record to the session-collections log", async () => {
    answer = { slug: "invoices", icon: "receipt_long", title: "Invoices" };

    const chatId = await spawn({ collection: "invoices" });
    await settleAppends();

    expect(appendedCollectionLines()).toEqual([{ id: chatId, slug: "invoices", icon: "receipt_long", title: "Invoices" }]);
  });

  // The other half of that finding, stated as the property it actually is: the response does NOT
  // wait on the disk. A write that never settles must still leave a served spawn and a correct
  // mark — because the mark is answered from memory for the whole life of the cell, and the only
  // thing a lost line costs is the glyph after a restart.
  //
  // A hang, not a delay: with `appendFile` mocked to resolve instantly the append lands within a
  // microtask or two either way, so timing alone cannot tell an awaited write from a fire-and-
  // forget one. Never settling is what makes the difference observable.
  it("answers the spawn even while the write never settles", async () => {
    // Hung by FILE, not by call order. This one route appends to two logs on two independent
    // chains — session-collections and unplaced-sessions — so a `mockReturnValueOnce` is claimed by
    // whichever reaches `appendFile` first, which is promise scheduling and not something this test
    // states. It happens to be the collections one today; moving two lines in the route would hand
    // the hang to the other log and leave this test green while asserting nothing.
    let release!: () => void;
    const hung = new Promise<undefined>((resolve) => (release = () => resolve(undefined)));
    appendFile.mockImplementation((file) => (file.endsWith("session-collections.jsonl") ? hung : Promise.resolve(undefined)));
    answer = { slug: "invoices", icon: "receipt_long", title: "Invoices" };

    const chatId = await spawn({ collection: "invoices" });

    // That OUR write is the one still hanging — not merely that it happened. "Was the collections
    // file appended to" is true either way, so it guards nothing; the promise identity is what says
    // the response came back over an unfinished write to THIS log.
    const ours = appendFile.mock.calls.findIndex((call) => call[0].endsWith("session-collections.jsonl"));
    expect(ours).toBeGreaterThanOrEqual(0);
    expect(appendFile.mock.results[ours]?.value).toBe(hung);
    expect(sessionCollections.get(chatId)).toEqual({ slug: "invoices", icon: "receipt_long", title: "Invoices" });
    // RELEASED before the test ends, and not merely for tidiness: the appends run on one serial
    // chain, so a write left hanging blocks every later one in this module — which is a real
    // property of the store, and leaving it stuck would make the next test's result about this one.
    release();
    await settleAppends();
    appendFile.mockReset();
  });

  // A failed write must not take the NEXT one with it. The catch sits at the END of the chain for
  // that reason; moved inside, one rejection would poison every append made afterwards.
  it("keeps appending after a write fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    appendFile.mockRejectedValueOnce(new Error("disk full"));

    answer = { slug: "invoices", icon: "receipt_long", title: "Invoices" };
    const failed = await spawn({ collection: "invoices" });
    await settleAppends();
    expect(sessionCollections.get(failed)).toMatchObject({ slug: "invoices" }); // still right in memory
    expect(logged).toHaveBeenCalled(); // and the failure was reported, not swallowed

    answer = { slug: "tasks", icon: "task", title: "Tasks" };
    const next = await spawn({ collection: "tasks" });
    await settleAppends();
    expect(appendedCollectionLines()).toContainEqual({ id: next, slug: "tasks", icon: "task", title: "Tasks" });
    logged.mockRestore();
  });
});
