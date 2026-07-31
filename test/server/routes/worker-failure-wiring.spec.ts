// @vitest-environment node
// The wiring between a hidden spawn and the failure it may end in.
//
// Each piece has its own spec — the record persists, the notify kind derives — and none of them
// prove the pieces are CONNECTED. This drives the real route and the real completion hook, which
// is the only place the decision "a hidden worker that never finished a turn has failed" actually
// happens.
import { describe, it, expect, vi } from "vitest";
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
const { isFailedWorker, unplacedSessionRows } = await import("../../../server/session/registry.js");

const app = express();
app.use(express.json());
mountPluginRoutes(app, {
  spawnClaudePty: (() => ({})) as never,
  spawnCodexPty: (() => ({})) as never,
  spawnAntigravityPty: (() => ({})) as never,
  registerBackgroundSession: () => {},
});

/** Spawn through the real route and hand back the id it minted. */
async function spawn(hidden: boolean, agent = "claude"): Promise<string> {
  const res = await request(app).post("/api/plugin/spawnBackgroundChat").send({ message: "do the thing", hidden, agent });
  return String((res.body as { jsonData?: { chatId?: string } }).jsonData?.chatId);
}

// PR3b: a VISIBLE spawn is marked as waiting for a grid cell. A hidden worker must never be —
// it has no business taking a cell, and the grid adopts whatever this list holds. Pinned because
// "it happens not to be marked" and "it cannot be marked" read identically until someone adds a
// caller, and the difference is a background refresh silently opening a terminal.
describe("what a spawn leaves waiting for a cell", () => {
  it("marks a visible chat as unplaced", async () => {
    const id = await spawn(false);
    expect(unplacedSessionRows().map((r) => r.id)).toContain(id);
  });

  it("does NOT mark a hidden worker", async () => {
    const id = await spawn(true);
    expect(unplacedSessionRows().map((r) => r.id)).not.toContain(id);
  });
});

describe("a hidden worker that ends badly", () => {
  it("is recorded when its run reaches teardown unfinished", async () => {
    const id = await spawn(true);
    expect(isFailedWorker(id)).toBe(false); // nothing decided while it runs

    // What lifecycle.reap() does for a session that never reported a finished turn.
    await runCompletionHook(id, { didError: true });

    expect(isFailedWorker(id)).toBe(true);
  });

  // The contract reap depends on. It fires the hook and then reads the flag on the very next
  // line, so it can put the outcome on the SAME teardown message — which is what stops the
  // generic notification racing ahead of the specific one. If this recorder ever became async,
  // reap would publish `failed: false` and the failure would go unannounced, silently.
  it("records SYNCHRONOUSLY, so reap can read the flag on the next line", async () => {
    const id = await spawn(true);

    void runCompletionHook(id, { didError: true }); // deliberately NOT awaited, as reap calls it

    expect(isFailedWorker(id)).toBe(true);
  });

  it("is NOT recorded when its turn finished first", async () => {
    // The one-shot contract doing the real work: the Stop hook reports success, and the teardown
    // that follows every session cannot overturn it. Without this, every successful worker would
    // be marked failed the moment it was cleaned up.
    const id = await spawn(true);
    await runCompletionHook(id, { didError: false });
    await runCompletionHook(id, { didError: true }); // reap, moments later

    expect(isFailedWorker(id)).toBe(false);
  });

  // Codex, on this PR. The only success signal a PTY-hosted agent gives us is Claude Code's Stop
  // hook; codex and antigravity have no hook mechanism, so they can never report success — and a
  // recorder registered for them would mark every SUCCESSFUL run failed at teardown. A signal
  // that is wrong more often than right is worse than the silence it replaced.
  it.each(["codex", "antigravity"])("says nothing for a hidden %s worker, which cannot report success", async (agent) => {
    const id = await spawn(true, agent);
    await runCompletionHook(id, { didError: true });
    expect(isFailedWorker(id)).toBe(false);
  });

  it("says nothing for a WATCHED session that dies", async () => {
    // hidden=false is a session with a cell: its failure is visible in its own terminal, and a
    // second signal for it would be noise. No hook is registered at all.
    const id = await spawn(false);
    await runCompletionHook(id, { didError: true });

    expect(isFailedWorker(id)).toBe(false);
  });
});
