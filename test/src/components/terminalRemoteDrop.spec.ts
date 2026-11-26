// A file dropped on a remote cell (#3506) is sent to that cell's host and the path the host saved it
// at is typed in: a path on THIS machine names nothing the remote agent can read, so it always uploads.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

const conn = vi.hoisted(() => ({ view: null as Map<string, { status: string }> | null, inserted: [] as string[] }));
vi.mock("../../../src/composables/useTerminalConnections", async () => {
  const { reactive } = await import("vue");
  const connView = reactive(new Map<string, { status: string }>());
  conn.view = connView;
  return {
    connView,
    attach: () => {},
    setFont: () => {},
    setTheme: () => {},
    detach: () => {},
    release: () => {},
    retarget: () => {},
    terminate: () => {},
    fit: () => {},
    focus: () => {},
    // (slot key, text): only the text is checked.
    insertText: (...args: string[]) => conn.inserted.push(args[1] ?? ""),
    sendView: () => {},
    readBuffer: () => null,
    submitText: () => true,
    isClaudeTarget: () => false,
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const Terminal = (await import("../../../src/components/Terminal.vue")).default;

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const KEY = "drop-spec";
let posted: { url: string; headers: Record<string, string> }[] = [];
beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  posted = [];
  conn.inserted = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ url: String(url), headers: { ...(init.headers as Record<string, string>) } });
      return { ok: true, json: async () => ({ path: "/srv/remote/.drops/notes.txt" }) };
    }
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
  conn.view?.clear();
  conn.view?.set(KEY, { status: "connected" });
});

const dropOn = async (remoteHost: string | null) => {
  const w = mount(Terminal, { props: { sessionId: SESSION, connectKey: 1, persistKey: KEY, cwd: "/srv/p", remoteHost } });
  await flushPromises();
  const file = new File(["hello"], "notes.txt", { type: "text/plain" });
  // The drag carries this machine's path too, as Safari and Firefox give it.
  const dataTransfer = {
    types: ["Files", "text/uri-list"],
    files: [file],
    getData: (type: string) => (type === "text/uri-list" ? "file:///Users/me/notes.txt" : ""),
  };
  const target = w.find(".min-h-0.flex-1.p-1");
  target.element.dispatchEvent(Object.assign(new Event("drop", { cancelable: true }), { dataTransfer }));
  await flushPromises();
  await flushPromises();
  return w;
};

describe("a drop on a remote cell", () => {
  it("sends the file to its host and types the path the host saved it at", async () => {
    await dropOn("lx");
    expect(posted.map((p) => p.url)).toEqual([`/remote/lx/api/session/${SESSION}/drop`]);
    expect(posted[0]?.headers["x-drop-filename"]).toBe("notes.txt");
    expect(conn.inserted).toEqual(["/srv/remote/.drops/notes.txt "]);
  });

  it("types this machine's path on a local cell, sending nothing", async () => {
    await dropOn(null);
    expect(posted).toEqual([]);
    expect(conn.inserted).toEqual(["/Users/me/notes.txt "]);
  });
});
