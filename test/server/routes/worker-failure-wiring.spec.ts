// @vitest-environment node
// The wiring between a hidden spawn and the failure it may end in.
//
// Each piece has its own spec — the record persists, the notify kind derives — and none of them
// prove the pieces are CONNECTED. This drives the real route and the real completion hook, which
// is the only place the decision "a hidden worker that never finished a turn has failed" actually
// happens.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// The registry persists what it records. node:fs is MOCKED rather than pointing HOME at a temp
// dir (tool-group-reset.spec's pattern): process.env is shared by every file in a vitest worker,
// so moving HOME here reached specs with nothing to do with this one and failed them
// intermittently. What is under test is the in-memory decision; persistence has its own spec.
vi.mock("node:fs", () => {
  const promises = {
    readFile: vi.fn(async () => ""),
    appendFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  return { promises, default: { promises } };
});

const { mountPluginRoutes } = await import("../../../server/routes/plugin-routes.js");
const { runCompletionHook } = await import("../../../server/session/completion-hooks.js");
const { isFailedWorker } = await import("../../../server/session/registry.js");
const { SESSIONS_CHANNEL } = await import("../../../server/session/lifecycle.js");

let published: { channel: string; data: Record<string, unknown> }[] = [];
const app = express();
app.use(express.json());
mountPluginRoutes(app, {
  spawnClaudePty: (() => ({})) as never,
  spawnCodexPty: (() => ({})) as never,
  spawnAntigravityPty: (() => ({})) as never,
  registerBackgroundSession: () => {},
  publish: (channel, data) => void published.push({ channel, data: data as Record<string, unknown> }),
});

beforeEach(() => {
  published = [];
});

/** Spawn through the real route and hand back the id it minted. */
async function spawn(hidden: boolean): Promise<string> {
  const res = await request(app).post("/api/plugin/spawnBackgroundChat").send({ message: "do the thing", hidden });
  return String((res.body as { jsonData?: { chatId?: string } }).jsonData?.chatId);
}

const failureEvents = (id: string) => published.filter((p) => p.channel === SESSIONS_CHANNEL && p.data.id === id && p.data.event === "worker-failed");

describe("a hidden worker that ends badly", () => {
  it("is recorded and announced when its run reaches teardown unfinished", async () => {
    const id = await spawn(true);
    expect(isFailedWorker(id)).toBe(false); // nothing decided while it runs

    // What lifecycle.reap() does for a session that never reported a finished turn.
    await runCompletionHook(id, { didError: true });

    expect(isFailedWorker(id)).toBe(true);
    expect(failureEvents(id)).toHaveLength(1);
  });

  it("is NOT recorded when its turn finished first", async () => {
    // The one-shot contract doing the real work: the Stop hook reports success, and the teardown
    // that follows every session cannot overturn it. Without this, every successful worker would
    // be marked failed the moment it was cleaned up.
    const id = await spawn(true);
    await runCompletionHook(id, { didError: false });
    await runCompletionHook(id, { didError: true }); // reap, moments later

    expect(isFailedWorker(id)).toBe(false);
    expect(failureEvents(id)).toEqual([]);
  });

  it("says nothing for a WATCHED session that dies", async () => {
    // hidden=false is a session with a cell: its failure is visible in its own terminal, and a
    // second signal for it would be noise. No hook is registered at all.
    const id = await spawn(false);
    await runCompletionHook(id, { didError: true });

    expect(isFailedWorker(id)).toBe(false);
    expect(failureEvents(id)).toEqual([]);
  });

  it("announces on the sessions channel with the shape the browser reads", async () => {
    // notifyKindOf keys on `event`; the id is what the row is matched by. Pinned because the two
    // sides of this message are in different files and nothing else compares them.
    const id = await spawn(true);
    await runCompletionHook(id, { didError: true });

    expect(failureEvents(id)[0].data).toEqual({ id, working: false, event: "worker-failed" });
  });
});
