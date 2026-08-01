import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { startCollectionChat, launchAgent } from "../../../src/composables/useChatLauncher";
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
  // Every non-hidden spawn is PLACED AS A GRID CELL. The real placement seam is used rather than a
  // mock of it, so these pin the actual wiring the collection UI depends on. A registered handler
  // also keeps the not-yet-mounted path (queue + navigate) out of these cases — it has its own
  // spec.
  let placed: SpawnedChatRequest[];
  beforeEach(() => {
    resetSpawnedChatQueue();
    placed = [];
    registerSpawnedChatHandler((req) => (placed.push(req), true));
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
    expect(placed).toEqual([{ id: "sess-1", agent: "claude", draft: false, canvas: false }]);
  });

  it("spawns a codex chat (auto-run, draft forced off) when the launch agent is codex", async () => {
    launchAgent.value = "codex";
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "cx-1", agent: "codex" } }) }));

    await startCollectionChat("summarize this", { draft: true }); // codex ignores draft — it auto-runs

    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({ message: "summarize this", draft: false, agent: "codex" });
    // The agent travels with the id: the cell reconnects on codex's endpoint, not claude's.
    expect(placed).toEqual([{ id: "cx-1", agent: "codex", draft: false, canvas: false }]);
  });

  it("sends draft:true so the prompt is prefilled but not auto-sent", async () => {
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "sess-3" } }) }));

    await startCollectionChat("track my tasks", { hidden: false, draft: true });

    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({ message: "track my tasks", draft: true, agent: "claude" });
    // draft travels to the cell too: a prompt waiting in the input box, not a turn running.
    expect(placed).toEqual([{ id: "sess-3", agent: "claude", draft: true, canvas: false }]);
  });

  // The Canvas is revealed only when there is something in it. That decision is made here, on the
  // seed, and travels with the placement — the grid must not have to re-derive it from the prompt.
  it("asks for the Canvas when the chat was started from a collection", async () => {
    mockFetch((url) => {
      if (url.includes("/api/collections/list")) return { ok: true, json: () => ({ collections: [{ slug: "invoices" }] }) };
      if (url.includes("/api/agent/toolResult")) return { ok: true, json: () => ({ ok: true }) };
      return { ok: true, json: () => ({ jsonData: { chatId: "sess-c" } }) };
    });

    await startCollectionChat("/invoices summarise this quarter");

    expect(placed).toEqual([{ id: "sess-c", agent: "claude", draft: false, canvas: true }]);
  });

  it("does not ask for the Canvas when the slug is not a collection", async () => {
    // `/deep-research …` is a SKILL's slash command. Enlarging a cell to show an empty pane takes
    // over the screen to display nothing.
    mockFetch((url) => {
      if (url.includes("/api/collections/list")) return { ok: true, json: () => ({ collections: [{ slug: "invoices" }] }) };
      return { ok: true, json: () => ({ jsonData: { chatId: "sess-d" } }) };
    });

    await startCollectionChat("/deep-research the market for X");

    expect(placed).toEqual([{ id: "sess-d", agent: "claude", draft: false, canvas: false }]);
  });

  it("does NOT place when hidden=true (a real background worker)", async () => {
    mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "sess-2" } }) }));
    await startCollectionChat("background work", { hidden: true });

    expect(placed).toEqual([]);
  });

  it("ignores an empty prompt (no spawn)", async () => {
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({}) }));
    await startCollectionChat("   ");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not place a cell when the spawn fails", async () => {
    mockFetch(() => ({ ok: false, json: () => ({}) }));
    await startCollectionChat("oops");

    // An empty cell attached to nothing is worse than no cell: there is no session to adopt.
    expect(placed).toEqual([]);
  });

  it("persists the launch agent to localStorage", async () => {
    launchAgent.value = "codex";
    await nextTick();
    expect(localStorage.getItem("mt-launch-agent")).toBe("codex");
  });
});
