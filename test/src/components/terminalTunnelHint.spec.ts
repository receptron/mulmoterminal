// A remote cell's socket goes through an ssh tunnel the user opened (#3506). When it drops, the pill
// alone says "disconnected"; the hint beside it names the host and the tunnel.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

const conn = vi.hoisted(() => ({ view: null as Map<string, { status: string }> | null }));
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
    insertText: () => {},
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

const KEY = "tunnel-spec";
beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
  conn.view?.clear();
});

const mountWith = async (remoteHost: string | null, status: string) => {
  conn.view?.set(KEY, { status });
  const w = mount(Terminal, { props: { sessionId: "s-1", connectKey: 1, persistKey: KEY, cwd: "/srv/p", remoteHost } });
  await flushPromises();
  return w;
};

describe("the tunnel hint", () => {
  it("names the host and the ssh tunnel while a remote cell is disconnected", async () => {
    const w = await mountWith("lx", "disconnected");
    const hint = w.find('[data-testid="term-tunnel-hint"]').text();
    expect(hint).toContain("lx");
    expect(hint).toContain("ssh -L");
  });

  it("is not shown while connecting or connected, or for a local cell", async () => {
    expect((await mountWith("lx", "connecting")).find('[data-testid="term-tunnel-hint"]').exists()).toBe(false);
    expect((await mountWith("lx", "connected")).find('[data-testid="term-tunnel-hint"]').exists()).toBe(false);
    expect((await mountWith(null, "disconnected")).find('[data-testid="term-tunnel-hint"]').exists()).toBe(false);
  });

  it("goes away when the tunnel is back", async () => {
    const w = await mountWith("lx", "disconnected");
    conn.view?.set(KEY, { status: "connected" });
    await nextTick();
    expect(w.find('[data-testid="term-tunnel-hint"]').exists()).toBe(false);
  });
});
