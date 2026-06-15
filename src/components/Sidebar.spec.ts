import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Sidebar from "./Sidebar.vue";

// Capture the pub/sub callback so tests can simulate a server push without a
// real socket.
let captured: ((data: unknown) => void) | null = null;
vi.mock("../composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (_channel: string, cb: (data: unknown) => void) => {
      captured = cb;
      return () => {};
    },
  }),
}));

interface SessionRow {
  id: string;
  title: string;
  mtime: number;
  working: boolean;
  waiting: boolean;
}

function mockSessions(sessions: SessionRow[]) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ cwd: "/x", sessions }),
  }) as unknown as typeof fetch;
}

function row(over: Partial<SessionRow> & { id: string }): SessionRow {
  return { title: over.id, mtime: 1, working: false, waiting: false, ...over };
}

describe("Sidebar", () => {
  beforeEach(() => {
    captured = null;
  });

  it("renders sessions from the server and shows the working dot", async () => {
    mockSessions([
      row({ id: "a", title: "Alpha", working: true }),
      row({ id: "b", title: "Beta" }),
    ]);
    const wrapper = mount(Sidebar, { props: { activeId: null } });
    await flushPromises();

    const items = wrapper.findAll(".item");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Alpha");
    // Only the working session shows the dot.
    expect(items[0].find(".dot").exists()).toBe(true);
    expect(items[1].find(".dot").exists()).toBe(false);
  });

  it("bolds a waiting session via the .waiting class", async () => {
    mockSessions([
      row({ id: "a", title: "Alpha", waiting: true }),
      row({ id: "b", title: "Beta", waiting: false }),
    ]);
    const wrapper = mount(Sidebar, { props: { activeId: null } });
    await flushPromises();

    const items = wrapper.findAll(".item");
    expect(items[0].classes()).toContain("waiting");
    expect(items[1].classes()).not.toContain("waiting");
  });

  it("refetches the authoritative list when a pub/sub event arrives", async () => {
    mockSessions([row({ id: "a", title: "Alpha" })]);
    const wrapper = mount(Sidebar, { props: { activeId: null } });
    await flushPromises();
    expect(wrapper.findAll(".item")).toHaveLength(1);

    // Server now reports a newly-created session; the push should trigger a reload.
    mockSessions([row({ id: "a", title: "Alpha" }), row({ id: "b", title: "New session" })]);
    captured?.({ id: "b", working: false, waiting: false, event: "created" });
    await flushPromises();
    expect(wrapper.findAll(".item")).toHaveLength(2);
  });

  it("emits select with the session id on click", async () => {
    mockSessions([row({ id: "a", title: "Alpha" })]);
    const wrapper = mount(Sidebar, { props: { activeId: null } });
    await flushPromises();

    await wrapper.find(".item").trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["a"]);
  });
});
