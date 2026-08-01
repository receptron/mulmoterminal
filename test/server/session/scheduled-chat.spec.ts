// @vitest-environment node
// What a scheduled task's chat IS. Three properties, and they are one decision seen from three
// sides — a scheduled task is dispatched by a clock, not by someone at a keyboard.
//
// node:fs is mocked rather than moving HOME: process.env is shared by every file in a vitest
// worker (tool-group-reset.spec's pattern).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => {
  const promises = {
    readFile: vi.fn(async () => ""),
    appendFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  return { promises, default: { promises } };
});

const ID = "11111111-1111-1111-1111-111111111111";

async function fresh() {
  vi.resetModules();
  const registry = await import("../../../server/session/registry.js");
  const { spawnScheduledWorker } = await import("../../../server/session/scheduled-chat.js");
  const { runCompletionHook } = await import("../../../server/session/completion-hooks.js");
  return { registry, spawnScheduledWorker, runCompletionHook };
}

const noop = { spawn: () => {}, retain: () => {} };

beforeEach(() => vi.clearAllMocks());

describe("a scheduled task's chat", () => {
  it("is a background worker, not a chat the user started", async () => {
    // It was already half of one — scheduledSessions.register puts it on the background retention,
    // whose reason is that nobody is waiting for it. The classification now agrees with that.
    const { registry, spawnScheduledWorker } = await fresh();
    spawnScheduledWorker(ID, noop);
    expect(registry.isBackgroundSession(ID)).toBe(true);
  });

  it("takes NO grid cell, however often the task fires", async () => {
    // THE reason this changed. A visible spawn is marked unplaced so the next grid adopts it, and
    // an hourly task would then add a cell per firing until MAX_TERMINALS — with nobody having
    // asked for a single terminal.
    const { registry, spawnScheduledWorker } = await fresh();
    for (let i = 0; i < 5; i++) spawnScheduledWorker(ID, noop);
    expect(registry.unplacedSessionRows()).toEqual([]);
  });

  // The one thing it does NOT inherit from being a background session. Suppressing this would
  // silence exactly the case the setting exists for: a task running while the user is away.
  it("stays reachable by Web Push", async () => {
    const { registry, spawnScheduledWorker } = await fresh();
    spawnScheduledWorker(ID, noop);
    expect(registry.isUserScheduledSession(ID)).toBe(true);
    // Both facts together are what the push rule reads — background, and yet the user's own task.
    expect(registry.isBackgroundSession(ID)).toBe(true);
  });

  it("still says so when it fails", async () => {
    // The other half of being quiet: nothing pulls the user's attention, so without the hook a
    // failed task is never learned. This is what reap does for a session that never reported a
    // finished turn.
    const { registry, spawnScheduledWorker, runCompletionHook } = await fresh();
    spawnScheduledWorker(ID, noop);
    await runCompletionHook(ID, { didError: true });
    expect(registry.isFailedWorker(ID)).toBe(true);
  });

  it("is NOT marked failed when its turn finished", async () => {
    // The one-shot contract: a finished turn reports success first, and the teardown that follows
    // every session cannot overturn it. Without this every successful task would be marked failed.
    const { registry, spawnScheduledWorker, runCompletionHook } = await fresh();
    spawnScheduledWorker(ID, noop);
    await runCompletionHook(ID, { didError: false });
    await runCompletionHook(ID, { didError: true }); // reap, moments later
    expect(registry.isFailedWorker(ID)).toBe(false);
  });

  it("spawns and retains, in that order", async () => {
    // Retention exists because nothing else would ever end this session; registering a session
    // that failed to spawn would put a dead id on it.
    const { spawnScheduledWorker } = await fresh();
    const order: string[] = [];
    spawnScheduledWorker(ID, { spawn: () => order.push("spawn"), retain: () => order.push("retain") });
    expect(order).toEqual(["spawn", "retain"]);
  });

  it("does not retain — or register a hook — when the spawn throws", async () => {
    // A launch that threw has no session to report on, and a hook registered for it would never
    // fire or be cleared.
    const { registry, spawnScheduledWorker, runCompletionHook } = await fresh();
    const retained: string[] = [];
    expect(() =>
      spawnScheduledWorker(ID, {
        spawn: () => {
          throw new Error("claude missing");
        },
        retain: (id) => retained.push(id),
      }),
    ).toThrow();

    expect(retained).toEqual([]);
    await runCompletionHook(ID, { didError: true });
    expect(registry.isFailedWorker(ID)).toBe(false);
  });
});
