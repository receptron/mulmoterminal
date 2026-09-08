// The pane shows THIS collection's session (#2001).
//
// The first version tied the session to the pane's own lifetime, and both halves of that were wrong
// in use: it stayed open after switching to another collection, and going to the grid and back left
// nothing to come back to. These cases are those two, plus the invariant that survived the rewrite —
// a running agent is never left on no screen at all.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import CollectionChatPane from "../../../src/components/CollectionChatPane.vue";
import { offerCollectionChat } from "../../../src/composables/collectionChatPane";
import { resetCollectionChats } from "../../../src/composables/collectionChatSessions";
import type { SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";

const placed = vi.hoisted((): { calls: SpawnedChatRequest[] } => ({ calls: [] }));
vi.mock("../../../src/composables/useSpawnedChat", () => ({
  placeSpawnedChat: (req: SpawnedChatRequest) => placed.calls.push(req),
}));
const released = vi.hoisted((): { keys: string[] } => ({ keys: [] }));
vi.mock("../../../src/composables/useTerminalConnections", () => ({
  release: (key: string) => released.keys.push(key),
}));
// Which collection is on screen. The pane reads it through useCollectionBrowse, so moving the view
// IS "switching collections" from the pane's point of view.
const browse = vi.hoisted((): { view: { value: unknown } } => ({ view: { value: null } }));
vi.mock("../../../src/composables/useCollectionBrowse", () => ({
  useCollectionBrowse: () => ({ view: browse.view }),
  browseRouteProjectId: () => null,
}));
// The supervision sources the pane reads. Real ones fetch and subscribe; what these cases are about
// is what the pane DOES with the answers.
type Activity = { working: boolean; waiting: boolean; event: string | null };
const feed = vi.hoisted(
  (): {
    activity: Map<string, Activity>;
    push: (data: unknown) => void;
    setTitle: (title: string | null) => void;
  } => ({ activity: new Map(), push: () => {}, setTitle: () => {} }),
);
vi.mock("../../../src/composables/useGridActivity", () => ({ useGridActivity: () => ({ activity: feed.activity }) }));
// The server's session channel, played by hand: a "closed" push is how the filing hears that a
// session ended while its terminal was not mounted.
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (_channel: string, callback: (data: unknown) => void) => {
      feed.push = callback;
      return () => {};
    },
  }),
}));
vi.mock("../../../src/composables/useSessionSummary", async () => {
  const { ref } = await import("vue");
  const meta = ref({ lastPrompt: null, aiTitle: null as string | null, lastResponse: null, memo: null, workPhase: null });
  feed.setTitle = (title) => (meta.value = { ...meta.value, aiTitle: title });
  return { useSessionSummary: () => meta };
});
// The terminal opens a socket and an xterm; what matters here is which session it is pointed at.
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "Terminal",
    props: ["sessionId", "connectKey", "agent", "persistKey"],
    template: '<div :data-session="sessionId" />',
  },
}));

const request = (id: string): SpawnedChatRequest => ({ id, agent: "claude", draft: false });
const at = (slug: string) => ({ mode: "detail", kind: "collection", slug });
const shown = (wrapper: ReturnType<typeof mount>): string | undefined => wrapper.find("[data-session]").attributes("data-session");
const tabs = (wrapper: ReturnType<typeof mount>) => wrapper.findAll("[role='tab']");

describe("CollectionChatPane", () => {
  beforeEach(() => {
    placed.calls = [];
    released.keys = [];
    resetCollectionChats();
    feed.activity.clear();
    feed.setTitle(null);
    browse.view = ref(at("works"));
  });

  it("runs the session here instead of sending it to the grid", async () => {
    const wrapper = mount(CollectionChatPane);
    expect(offerCollectionChat(request("a"))).toBe(true);
    await wrapper.vm.$nextTick();
    expect(shown(wrapper)).toBe("a");
    expect(placed.calls).toEqual([]);
    wrapper.unmount();
  });

  // (1) The pane used to stay open on whatever was started last, whichever collection you moved to.
  it("follows the collection: another one's pane is its own, or empty", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("works-chat"));
    await wrapper.vm.$nextTick();
    expect(shown(wrapper)).toBe("works-chat");

    browse.view.value = at("todos"); // switch collections
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-session]").exists()).toBe(false);

    offerCollectionChat(request("todos-chat"));
    await wrapper.vm.$nextTick();
    expect(shown(wrapper)).toBe("todos-chat");

    browse.view.value = at("works"); // ...and back
    await wrapper.vm.$nextTick();
    expect(shown(wrapper)).toBe("works-chat");
    expect(placed.calls).toEqual([]); // nothing was moved anywhere by looking around
    wrapper.unmount();
  });

  // (2) Going to the grid and back used to leave nothing: the session had been handed away on close.
  it("is still there after the overlay closes and opens again", async () => {
    const first = mount(CollectionChatPane);
    offerCollectionChat(request("a"));
    await first.vm.$nextTick();
    first.unmount(); // the overlay closed

    expect(placed.calls).toEqual([]); // ...and that is NOT a hand-off
    const second = mount(CollectionChatPane);
    await second.vm.$nextTick();
    expect(shown(second)).toBe("a");
    second.unmount();
  });

  it("hands it over on Move to the grid, and stops showing it", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("a"));
    await wrapper.vm.$nextTick();
    await wrapper.get("button[title*='Move this']").trigger("click");
    expect(placed.calls.map((c) => c.id)).toEqual(["a"]);
    expect(wrapper.find("[data-session]").exists()).toBe(false);
    expect(released.keys).toEqual(["collection-chat-a"]); // the durable slot goes with it
    wrapper.unmount();
  });

  // A second question while the first is still working is the ordinary case. It used to cost the
  // first one its screen; now they are tabs and both keep their terminal.
  it("keeps both when a second chat starts in the same collection", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("first"));
    offerCollectionChat(request("second"));
    await wrapper.vm.$nextTick();
    expect(placed.calls).toEqual([]); // nothing was pushed anywhere
    expect(tabs(wrapper)).toHaveLength(2);
    expect(shown(wrapper)).toBe("second"); // the new one is what you are looking at
    wrapper.unmount();
  });

  it("switches terminals when another tab is pressed", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("first"));
    offerCollectionChat(request("second"));
    await wrapper.vm.$nextTick();
    await tabs(wrapper)[0].trigger("click");
    expect(shown(wrapper)).toBe("first");
    expect(tabs(wrapper)[0].attributes("aria-selected")).toBe("true");
    expect(tabs(wrapper)[1].attributes("aria-selected")).toBe("false");
    wrapper.unmount();
  });

  // Moving one out leaves the rest alone — and lands you on its left neighbour, which is where you
  // were before you opened it.
  it("moves only the tab you are looking at", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("first"));
    offerCollectionChat(request("second"));
    await wrapper.vm.$nextTick();
    await wrapper.get("button[title*='Move this']").trigger("click");
    expect(placed.calls.map((c) => c.id)).toEqual(["second"]);
    expect(tabs(wrapper)).toHaveLength(1);
    expect(shown(wrapper)).toBe("first");
    wrapper.unmount();
  });

  it("stops offering a session that has exited", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("a"));
    await wrapper.vm.$nextTick();
    wrapper.findComponent({ name: "Terminal" }).vm.$emit("exit", 0);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-session]").exists()).toBe(false);
    expect(placed.calls).toEqual([]); // nothing to move — it ended
    wrapper.unmount();
  });

  // Each session gets its own durable slot, which is what brings the terminal back rather than
  // reconnecting it: the same session shown again reuses the same slot name.
  it("gives the terminal a slot named for its session", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("a"));
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: "Terminal" }).props("persistKey")).toBe("collection-chat-a");
    wrapper.unmount();
  });

  // A tab that only says "something is running" is the half a grid cell never had to say. The dot
  // and the line come from the same sources the cockpit roster reads.
  it("shows whose turn it is, in the grid's own colours", async () => {
    feed.activity.set("a", { working: false, waiting: true, event: "Notification" }); // blocked
    feed.activity.set("b", { working: true, waiting: false, event: null }); // working
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("a"));
    offerCollectionChat(request("b"));
    await wrapper.vm.$nextTick();
    expect(tabs(wrapper)[0].find(".bg-amber").exists()).toBe(true);
    expect(tabs(wrapper)[1].find(".bg-muted").exists()).toBe(true);
    expect(tabs(wrapper)[0].attributes("title")).toContain("waiting on you");
    wrapper.unmount();
  });

  it("says what the agent is doing", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("a"));
    feed.setTitle("Fixing the failing spec");
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Fixing the failing spec");
    wrapper.unmount();
  });

  // Codex on #2002: a session that ends while its terminal is NOT mounted never fires `exit` — the
  // slot's handlers are cleared on detach, and attaching again replays session and cwd, not an end
  // already seen. The tab goes when the server says the session closed.
  it("drops a tab whose session has ended off-screen", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("gone"));
    offerCollectionChat(request("alive"));
    await wrapper.vm.$nextTick();
    feed.push({ id: "gone", event: "closed" });
    await wrapper.vm.$nextTick();
    expect(tabs(wrapper)).toHaveLength(1);
    expect(shown(wrapper)).toBe("alive");
    expect(placed.calls).toEqual([]); // it ended — there is nothing to move to the grid
    wrapper.unmount();
  });

  // `role="tab"` is a promise about the keyboard (Codex, #2002).
  it("moves between tabs with the arrow keys, and keeps one in the tab order", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("first"));
    offerCollectionChat(request("second"));
    await wrapper.vm.$nextTick();
    expect(tabs(wrapper).map((t) => t.attributes("tabindex"))).toEqual(["-1", "0"]);

    await tabs(wrapper)[1].trigger("keydown", { key: "ArrowRight" }); // wraps to the first
    expect(shown(wrapper)).toBe("first");
    await tabs(wrapper)[0].trigger("keydown", { key: "End" });
    expect(shown(wrapper)).toBe("second");
    await tabs(wrapper)[1].trigger("keydown", { key: "Home" });
    expect(shown(wrapper)).toBe("first");
    wrapper.unmount();
  });

  it("names the panel its tabs control", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("a"));
    await wrapper.vm.$nextTick();
    const panel = wrapper.get("[role='tabpanel']");
    expect(tabs(wrapper)[0].attributes("aria-controls")).toBe(panel.attributes("id"));
    wrapper.unmount();
  });
});
