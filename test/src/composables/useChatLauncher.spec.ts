import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { registerChatOpener, startCollectionChat, launchAgent } from "../../../src/composables/useChatLauncher";
import { registerSpawnedChatHandler, resetSpawnedChatQueue, type SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; json: () => unknown }) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const r = impl(url, init);
    return Promise.resolve({ ok: r.ok, status: r.ok ? 200 : 500, json: () => Promise.resolve(r.json()) } as Response);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("startCollectionChat", () => {
  // Every non-hidden spawn is PLACED AS A GRID CELL, not selected in the single view. The
  // real placement seam is used rather than a mock of it, so these pin the actual wiring the
  // collection UI depends on. A registered handler also keeps the no-grid path (queue +
  // router.push) out of these cases — it has its own spec.
  let placed: SpawnedChatRequest[];
  beforeEach(() => {
    registerChatOpener(vi.fn());
    resetSpawnedChatQueue();
    placed = [];
    registerSpawnedChatHandler((req) => placed.push(req));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    launchAgent.value = "claude"; // reset shared state so the codex test doesn't leak
    resetSpawnedChatQueue(); // a request left queued here would drain into the next spec's handler
  });

  it("spawns a chat seeded with the prompt and places it as a cell (hidden=false)", async () => {
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "sess-1" } }) }));

    await startCollectionChat("fix my records", { hidden: false });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/plugin/spawnBackgroundChat");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ message: "fix my records", draft: false, agent: "claude" });
    expect(placed).toEqual([{ id: "sess-1", agent: "claude", draft: false }]);
  });

  it("spawns a codex chat (auto-run, draft forced off) when the launch agent is codex", async () => {
    launchAgent.value = "codex";
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "cx-1", agent: "codex" } }) }));

    await startCollectionChat("summarize this", { draft: true }); // codex ignores draft — it auto-runs

    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({ message: "summarize this", draft: false, agent: "codex" });
    // The agent travels with the id: the cell reconnects on codex's endpoint, not claude's.
    expect(placed).toEqual([{ id: "cx-1", agent: "codex", draft: false }]);
  });

  it("sends draft:true so the prompt is prefilled but not auto-sent", async () => {
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "sess-3" } }) }));

    await startCollectionChat("track my tasks", { hidden: false, draft: true });

    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({ message: "track my tasks", draft: true, agent: "claude" });
    // draft travels to the cell too: a prompt waiting in the input box, not a turn running.
    expect(placed).toEqual([{ id: "sess-3", agent: "claude", draft: true }]);
  });

  it("does NOT place when hidden=true (a real background worker)", async () => {
    mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "sess-2" } }) }));
    const opener = vi.fn();
    registerChatOpener(opener);

    await startCollectionChat("background work", { hidden: true });

    expect(placed).toEqual([]);
    expect(opener).not.toHaveBeenCalled();
  });

  it("ignores an empty prompt (no spawn)", async () => {
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({}) }));
    await startCollectionChat("   ");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not place a cell when the spawn fails", async () => {
    mockFetch(() => ({ ok: false, json: () => ({}) }));
    const opener = vi.fn();
    registerChatOpener(opener);

    await startCollectionChat("oops");

    // An empty cell attached to nothing is worse than no cell: there is no session to adopt.
    expect(placed).toEqual([]);
    expect(opener).not.toHaveBeenCalled();
  });

  it("persists the launch agent to localStorage", async () => {
    launchAgent.value = "codex";
    await nextTick();
    expect(localStorage.getItem("mt-launch-agent")).toBe("codex");
  });
});
