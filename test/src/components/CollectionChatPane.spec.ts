// The pane is a HOLDER, not an owner (#2001). Every case here is about the one invariant that
// makes that safe: a session it stops showing is handed to the grid, never dropped. A session with
// no screen is a live agent nobody can see — and the PTY outlives the browser, so it would sit
// there running.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import CollectionChatPane from "../../../src/components/CollectionChatPane.vue";
import { offerCollectionChat } from "../../../src/composables/collectionChatPane";
import type { SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";

const placed = vi.hoisted((): { calls: SpawnedChatRequest[] } => ({ calls: [] }));
vi.mock("../../../src/composables/useSpawnedChat", () => ({
  placeSpawnedChat: (req: SpawnedChatRequest) => placed.calls.push(req),
}));
// The terminal itself opens a socket and an xterm; what matters here is which session it is
// pointed at, so it is stubbed down to that.
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: { name: "Terminal", props: ["sessionId", "connectKey", "agent"], template: '<div :data-session="sessionId" />' },
}));

const request = (id: string): SpawnedChatRequest => ({ id, agent: "claude", draft: false });

describe("CollectionChatPane", () => {
  beforeEach(() => {
    placed.calls = [];
  });

  it("shows nothing until a chat is started", () => {
    const wrapper = mount(CollectionChatPane);
    expect(wrapper.find("[data-session]").exists()).toBe(false);
    expect(offerCollectionChat(request("a"))).toBe(true); // ...but it has claimed the placement
    wrapper.unmount();
  });

  it("runs the session here instead of sending it to the grid", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("a"));
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-session]").attributes("data-session")).toBe("a");
    expect(placed.calls).toEqual([]); // the grid has not been asked for anything
    wrapper.unmount();
  });

  // The overlay closing is the ordinary end of a pane's life, and the session has to survive it.
  it("hands what it holds to the grid when it unmounts", () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("a"));
    wrapper.unmount();
    expect(placed.calls.map((c) => c.id)).toEqual(["a"]);
  });

  it("hands it over on Move to the grid, and stops showing it", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("a"));
    await wrapper.vm.$nextTick();
    await wrapper.get("button").trigger("click");
    expect(placed.calls.map((c) => c.id)).toEqual(["a"]);
    expect(wrapper.find("[data-session]").exists()).toBe(false);
    wrapper.unmount();
    expect(placed.calls.map((c) => c.id)).toEqual(["a"]); // ...and not a second time on unmount
  });

  // One at a time. The first session must not be dropped to make room — it is running.
  it("pushes the one it holds to the grid when a second chat starts", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("first"));
    offerCollectionChat(request("second"));
    await wrapper.vm.$nextTick();
    expect(placed.calls.map((c) => c.id)).toEqual(["first"]);
    expect(wrapper.find("[data-session]").attributes("data-session")).toBe("second");
    wrapper.unmount();
    expect(placed.calls.map((c) => c.id)).toEqual(["first", "second"]);
  });

  // The terminal slot is retargeted by the key, the way a cell re-attaches — without it the second
  // session would be shown in a slot still wired to the first.
  it("retargets the terminal slot for each session it shows", async () => {
    const wrapper = mount(CollectionChatPane);
    offerCollectionChat(request("first"));
    await wrapper.vm.$nextTick();
    const first = wrapper.findComponent({ name: "Terminal" }).props("connectKey");
    offerCollectionChat(request("second"));
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: "Terminal" }).props("connectKey")).not.toBe(first);
    wrapper.unmount();
  });
});
