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

describe("CollectionChatPane", () => {
  beforeEach(() => {
    placed.calls = [];
    released.keys = [];
    resetCollectionChats();
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
    await wrapper.get("button").trigger("click");
    expect(placed.calls.map((c) => c.id)).toEqual(["a"]);
    expect(wrapper.find("[data-session]").exists()).toBe(false);
    expect(released.keys).toEqual(["collection-chat-a"]); // the durable slot goes with it
    wrapper.unmount();
  });

  // A running agent is never left on no screen at all — the invariant that outlived the rewrite.
  it("pushes the one it holds to the grid when a second chat starts in the same collection", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("first"));
    offerCollectionChat(request("second"));
    await wrapper.vm.$nextTick();
    expect(placed.calls.map((c) => c.id)).toEqual(["first"]);
    expect(shown(wrapper)).toBe("second");
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
});
