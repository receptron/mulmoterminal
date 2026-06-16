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

  it("renders sessions from the server and shows the working spinner", async () => {
    mockSessions([
      row({ id: "a", title: "Alpha", working: true }),
      row({ id: "b", title: "Beta" }),
    ]);
    const wrapper = mount(Sidebar, { props: { activeId: null } });
    await flushPromises();

    const items = wrapper.findAll(".item");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Alpha");
    // Only the working session shows the spinner.
    expect(items[0].find(".spinner").exists()).toBe(true);
    expect(items[1].find(".spinner").exists()).toBe(false);
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

  it("hides the spinner while a session is waiting for input", async () => {
    // A session waiting for input keeps `working` true server-side, but it is
    // blocked on the user — spinning there reads as "thinking", so suppress it.
    mockSessions([row({ id: "a", title: "Alpha", working: true, waiting: true })]);
    const wrapper = mount(Sidebar, { props: { activeId: null } });
    await flushPromises();

    const item = wrapper.find(".item");
    expect(item.find(".spinner").exists()).toBe(false);
    expect(item.classes()).toContain("waiting");
  });

  it("hides the spinner on the active session even while it is working", async () => {
    // The open session's progress is visible in the terminal; a spinner on it is
    // redundant (it also reappears right after selecting a waiting session).
    mockSessions([
      row({ id: "a", title: "Alpha", working: true }),
      row({ id: "b", title: "Beta", working: true }),
    ]);
    const wrapper = mount(Sidebar, { props: { activeId: "a" } });
    await flushPromises();

    const items = wrapper.findAll(".item");
    expect(items[0].find(".spinner").exists()).toBe(false); // active
    expect(items[1].find(".spinner").exists()).toBe(true); // background
  });

  it("filters to unread (waiting) sessions when the Unread chip is active", async () => {
    mockSessions([
      row({ id: "a", title: "Alpha", waiting: true }),
      row({ id: "b", title: "Beta", waiting: false }),
    ]);
    const wrapper = mount(Sidebar, { props: { activeId: null } });
    await flushPromises();

    // "All" by default shows both.
    expect(wrapper.findAll(".item")).toHaveLength(2);

    // The Unread chip reports the count and, once active, hides read rows.
    const unreadChip = wrapper.findAll(".chip")[1];
    expect(unreadChip.text()).toContain("(1)");
    await unreadChip.trigger("click");

    const items = wrapper.findAll(".item");
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain("Alpha");
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

  it("keeps existing rows in place when a pub/sub refresh reorders the server list", async () => {
    // Server sorts by recency; switching sessions bumps mtimes and would
    // reshuffle rows under the user. The displayed order must stay stable.
    mockSessions([row({ id: "a" }), row({ id: "b" })]);
    const wrapper = mount(Sidebar, { props: { activeId: null } });
    await flushPromises();
    expect(wrapper.findAll(".item-title").map((i) => i.text().trim())).toEqual(["a", "b"]);

    // b is now newest (server returns it first), but the row order must not move.
    mockSessions([row({ id: "b" }), row({ id: "a" })]);
    captured?.({ id: "b", working: false, waiting: false, event: "updated" });
    await flushPromises();
    expect(wrapper.findAll(".item-title").map((i) => i.text().trim())).toEqual(["a", "b"]);
  });

  it("re-sorts by recency when the Refresh button is clicked", async () => {
    mockSessions([row({ id: "a" }), row({ id: "b" })]);
    const wrapper = mount(Sidebar, { props: { activeId: null } });
    await flushPromises();

    mockSessions([row({ id: "b" }), row({ id: "a" })]);
    await wrapper.find(".sort-btn").trigger("click"); // ⟳ Sort by most recent
    await flushPromises();
    expect(wrapper.findAll(".item-title").map((i) => i.text().trim())).toEqual(["b", "a"]);
  });

  it("emits select with the session id on click", async () => {
    mockSessions([row({ id: "a", title: "Alpha" })]);
    const wrapper = mount(Sidebar, { props: { activeId: null } });
    await flushPromises();

    await wrapper.find(".item").trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["a"]);
  });
});
