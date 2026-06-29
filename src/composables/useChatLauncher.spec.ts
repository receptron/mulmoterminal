import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerChatOpener, startCollectionChat } from "./useChatLauncher";

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
  afterEach(() => vi.unstubAllGlobals());

  it("spawns a chat seeded with the prompt and selects it (hidden=false)", async () => {
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "sess-1" } }) }));
    const opener = vi.fn();
    registerChatOpener(opener);

    await startCollectionChat("fix my records", { hidden: false });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/plugin/spawnBackgroundChat");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ message: "fix my records", draft: false });
    expect(opener).toHaveBeenCalledWith("sess-1");
  });

  it("sends draft:true so the prompt is prefilled but not auto-sent", async () => {
    const fetchFn = mockFetch(() => ({ ok: true, json: () => ({ jsonData: { chatId: "sess-3" } }) }));
    const opener = vi.fn();
    registerChatOpener(opener);

    await startCollectionChat("track my tasks", { hidden: false, draft: true });

    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({ message: "track my tasks", draft: true });
    expect(opener).toHaveBeenCalledWith("sess-3"); // still surfaced for the user to review/send
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
});
