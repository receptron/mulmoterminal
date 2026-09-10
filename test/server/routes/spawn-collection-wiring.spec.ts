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
vi.mock("node:fs", () => {
  const promises = {
    readFile: vi.fn(async () => ""),
    appendFile: vi.fn(async () => undefined),
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
});

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
  });
});
