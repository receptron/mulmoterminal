import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { registerChatOpener, startCollectionChat, launchAgent } from "./useChatLauncher";

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; json: () => unknown }) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const r = impl(url, init);
    return Promise.resolve({ ok: r.ok, status: r.ok ? 200 : 500, json: () => Promise.resolve(r.json()) } as Response);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("startCollectionChat", () => {
  beforeEach(() => registerChatOpener(vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    launchAgent.value = "claude"; // reset shared state so the codex test doesn't leak
  });

  it("spawns a chat seeded with the prompt and selects it (hidden=false)", async () => {
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "sess-1" } }) }));
    const opener = vi.fn();
    registerChatOpener(opener);

    await startCollectionChat("fix my records", { hidden: false });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/plugin/spawnBackgroundChat");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ message: "fix my records", draft: false, agent: "claude" });
    expect(opener).toHaveBeenCalledWith("sess-1", { draft: false, agent: "claude" });
  });

  it("spawns a codex chat (auto-run, draft forced off) when the launch agent is codex", async () => {
    launchAgent.value = "codex";
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "cx-1", agent: "codex" } }) }));
    const opener = vi.fn();
    registerChatOpener(opener);

    await startCollectionChat("summarize this", { draft: true }); // codex ignores draft — it auto-runs

    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({ message: "summarize this", draft: false, agent: "codex" });
    expect(opener).toHaveBeenCalledWith("cx-1", { draft: false, agent: "codex" });
  });

  it("sends draft:true so the prompt is prefilled but not auto-sent", async () => {
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "sess-3" } }) }));
    const opener = vi.fn();
    registerChatOpener(opener);

    await startCollectionChat("track my tasks", { hidden: false, draft: true });

    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({ message: "track my tasks", draft: true, agent: "claude" });
    expect(opener).toHaveBeenCalledWith("sess-3", { draft: true, agent: "claude" }); // surfaced + flagged for the preparing hint
  });

  it("does NOT select when hidden=true (stays in the sidebar)", async () => {
    mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "sess-2" } }) }));
    const opener = vi.fn();
    registerChatOpener(opener);

    await startCollectionChat("background work", { hidden: true });

    expect(opener).not.toHaveBeenCalled();
  });

  it("ignores an empty prompt (no spawn)", async () => {
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({}) }));
    await startCollectionChat("   ");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not select when the spawn fails", async () => {
    mockFetch(() => ({ ok: false, json: () => ({}) }));
    const opener = vi.fn();
    registerChatOpener(opener);

    await startCollectionChat("oops");

    expect(opener).not.toHaveBeenCalled();
  });

  it("persists the launch agent to localStorage", async () => {
    launchAgent.value = "codex";
    await nextTick();
    expect(localStorage.getItem("mt-launch-agent")).toBe("codex");
  });
});
