// @vitest-environment node
// Which sessions are waiting for a grid cell, and — the part that matters — which stop waiting.
//
// The mark exists for the case nobody is looking: a task firing at 3am, a chat the phone started,
// one an agent started from another session. So the two things worth pinning are that it SURVIVES
// (it is persisted, and a restart is exactly what happens before anyone opens a tab) and that it
// is CLEARED once a cell has the session — otherwise every load re-adopts what the last one took.
//
// node:fs is mocked rather than moving HOME: process.env is shared by every file in a vitest
// worker (tool-group-reset.spec's pattern).
import { describe, it, expect, vi, beforeEach } from "vitest";

const appended: { file: string; data: string }[] = [];
let readBack: Record<string, string> = {};

vi.mock("node:fs", () => {
  const promises = {
    readFile: vi.fn(async (file: unknown) => readBack[String(file).split("/").pop() ?? ""] ?? ""),
    appendFile: vi.fn(async (file: string, data: string) => {
      appended.push({ file: String(file), data });
    }),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  return { promises, default: { promises } };
});

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

async function freshRegistry() {
  vi.resetModules();
  appended.length = 0;
  return import("../../../server/session/registry.js");
}

// Matched on the exact BASENAME, not endsWith: "unplaced-sessions.json" ends with
// "placed-sessions.json", so a suffix match reads both logs as one and every assertion about the
// placed log silently counts the unplaced one too.
const loggedTo = (name: string) =>
  appended
    .filter((a) => a.file.split("/").pop() === name)
    .map((a) => a.data)
    .join("");

beforeEach(() => {
  vi.clearAllMocks();
  readBack = {};
});

describe("unplaced sessions", () => {
  it("lists a session the server spawned with nobody to place it", async () => {
    const registry = await freshRegistry();
    await Promise.all([registry.unplacedSessionsHydrated, registry.placedSessionsHydrated]);
    registry.markUnplacedSession(A);
    expect(registry.unplacedSessionRows().map((r) => r.id)).toEqual([A]);
  });

  it("drops it once a cell has attached", async () => {
    const registry = await freshRegistry();
    registry.markUnplacedSession(A);
    registry.markSessionPlaced(A);
    expect(registry.unplacedSessionRows().map((r) => r.id)).toEqual([]);
  });

  it("persists both facts, so neither is lost to a restart", async () => {
    const registry = await freshRegistry();
    registry.markUnplacedSession(A);
    registry.markSessionPlaced(A);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loggedTo("unplaced-sessions.json")).toContain(A);
    expect(loggedTo("placed-sessions.json")).toContain(A);
  });

  it("does not hand back a session that was placed BEFORE this process started", async () => {
    // The append-only hazard: hydration reads the unplaced log as it was, including ids a later
    // line in the placed log has since answered. Replaying only the first would re-adopt, on every
    // load, every session any grid has ever taken.
    readBack = { "unplaced-sessions.json": `${A}\n${B}`, "placed-sessions.json": A };
    const registry = await freshRegistry();
    await Promise.all([registry.unplacedSessionsHydrated, registry.placedSessionsHydrated]);
    expect(registry.unplacedSessionRows().map((r) => r.id)).toEqual([B]);
  });

  it("does not re-append an id it already holds", async () => {
    const registry = await freshRegistry();
    registry.markUnplacedSession(A);
    registry.markUnplacedSession(A);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loggedTo("unplaced-sessions.json").split(A).length - 1).toBe(1);
  });

  // Codex, on this PR. The id alone cannot reconnect a cell: adopting a codex session over
  // claude's endpoint attaches to the wrong agent, and the live PtyEntry that would have said so
  // is exactly what is missing in the case this marker exists for.
  it("remembers which agent the session runs, and survives with it", async () => {
    const registry = await freshRegistry();
    registry.markUnplacedSession(A, "codex");
    registry.markUnplacedSession(B); // default
    expect(registry.unplacedSessionRows()).toEqual([
      { id: A, agent: "codex" },
      { id: B, agent: "claude" },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loggedTo("unplaced-sessions.json")).toContain(`${A} codex`);
  });

  it("reads the agent back after a restart, and defaults a line written without one", async () => {
    // The second half is the upgrade case: a log written before the agent field existed holds
    // bare ids, and those sessions were all claude.
    readBack = { "unplaced-sessions.json": `${A} antigravity\n${B}` };
    const registry = await freshRegistry();
    await Promise.all([registry.unplacedSessionsHydrated, registry.placedSessionsHydrated]);
    expect(registry.unplacedSessionRows()).toEqual([
      { id: A, agent: "antigravity" },
      { id: B, agent: "claude" },
    ]);
  });

  // Codex, on this PR. markSessionPlaced runs at ALL FOUR ws attach points, so a long-lived
  // session reconnecting — a reload, a network blip, a page switch in the grid — would append a
  // line every time. The log would then grow with ATTACH count rather than session count, and
  // /api/sessions/unplaced waits on hydrating it. Every other mark in the registry is already a
  // no-op once known; this one was not.
  it("appends the placed mark once, however many times a session reattaches", async () => {
    const registry = await freshRegistry();
    registry.markUnplacedSession(A);
    for (let i = 0; i < 20; i++) registry.markSessionPlaced(A);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loggedTo("placed-sessions.json").split(A).length - 1).toBe(1);
    expect(registry.unplacedSessionRows()).toEqual([]);
  });

  it("ignores an id that is not a session id", async () => {
    const registry = await freshRegistry();
    registry.markUnplacedSession("../etc/passwd");
    registry.markSessionPlaced("../etc/passwd");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loggedTo("unplaced-sessions.json")).not.toContain("passwd");
    expect(registry.unplacedSessionRows().map((r) => r.id)).toEqual([]);
  });
});
