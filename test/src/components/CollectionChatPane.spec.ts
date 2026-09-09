// The pane under an open collection (#2001).
//
// It owns no terminal. A chat is an ordinary grid cell, and the pane is the receptacle the grid
// TELEPORTS that cell into while its collection is open — so what these cases check is which
// session is claimed, and when the claim is given back.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import CollectionChatPane from "../../../src/components/CollectionChatPane.vue";
import { holdCollectionChat, resetCollectionChats } from "../../../src/composables/collectionChatSessions";
import { collectionChatKey } from "../../../src/composables/collectionChatKey";
import { collectionChatDock } from "../../../src/composables/collectionChatDock";
import type { SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";

// Which collection is on screen. The pane reads it through useCollectionBrowse, so moving the view
// IS "switching collections" from the pane's point of view.
const browse = vi.hoisted((): { view: { value: unknown } } => ({ view: { value: null } }));
vi.mock("../../../src/composables/useCollectionBrowse", async () => {
  const { collectionChatKey } = await import("../../../src/composables/collectionChatKey");
  return { currentCollectionChatKey: () => collectionChatKey(browse.view.value as never, null) };
});
// The claim, recorded rather than acted on: what the grid does with it is TerminalGrid's business.
const claim = vi.hoisted((): { current: { sessionId: string; el: unknown } | null } => ({ current: null }));
vi.mock("../../../src/composables/collectionTerminalClaim", () => ({
  claimCollectionTerminal: (sessionId: string, el: unknown) => (claim.current = { sessionId, el }),
  releaseCollectionTerminal: (sessionId: string) => {
    if (claim.current?.sessionId === sessionId) claim.current = null;
  },
}));
// The supervision sources the tab strip reads. Real ones fetch and subscribe; what these cases are
// about is what the strip DOES with the answers.
type Activity = { working: boolean; waiting: boolean; event: string | null };
const feed = vi.hoisted((): { activity: Map<string, Activity>; setTitle: (title: string | null) => void } => ({ activity: new Map(), setTitle: () => {} }));
vi.mock("../../../src/composables/useGridActivity", () => ({ useGridActivity: () => ({ activity: feed.activity }) }));
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onConnect: () => () => {} }),
}));
vi.mock("../../../src/composables/useTerminalConnections", () => ({ release: () => {} }));
vi.mock("../../../src/composables/useSessionSummary", async () => {
  const { ref } = await import("vue");
  const meta = ref({ lastPrompt: null, aiTitle: null as string | null, lastResponse: null, memo: null, workPhase: null });
  feed.setTitle = (title) => (meta.value = { ...meta.value, aiTitle: title });
  return { useSessionSummary: () => meta };
});

const request = (id: string, agent: SpawnedChatRequest["agent"] = "claude"): SpawnedChatRequest => ({ id, agent, draft: false });
const at = (slug: string) => ({ mode: "detail", kind: "collection", slug });
const keyOf = (slug: string) => collectionChatKey(at(slug) as never, null) ?? "";
const file = (slug: string, id: string, agent: SpawnedChatRequest["agent"] = "claude") => holdCollectionChat(keyOf(slug), request(id, agent));
const shown = (): string | null => claim.current?.sessionId ?? null;
const tabs = (wrapper: ReturnType<typeof mount>) => wrapper.findAll("[role='tab']");

describe("CollectionChatPane", () => {
  beforeEach(() => {
    resetCollectionChats();
    claim.current = null;
    feed.activity.clear();
    feed.setTitle(null);
    browse.view = ref(at("works"));
    collectionChatDock.value = "bottom";
    localStorage.removeItem("mt-collection-chat-height");
    localStorage.removeItem("mt-collection-chat-width");
  });

  it("claims the chat it is showing, and hands the grid somewhere to put it", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await wrapper.vm.$nextTick();
    expect(shown()).toBe("a");
    expect(claim.current?.el).toBe(wrapper.get("[role='tabpanel']").element);
    wrapper.unmount();
  });

  // Switching collections switches what the pane is showing; the chats of the one you left keep
  // running in the grid, which is where they live.
  it("follows the collection, and claims nothing where there is nothing", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "works-chat");
    await wrapper.vm.$nextTick();
    expect(shown()).toBe("works-chat");

    browse.view.value = at("todos");
    await wrapper.vm.$nextTick();
    expect(shown()).toBeNull();

    file("todos", "todos-chat");
    await wrapper.vm.$nextTick();
    expect(shown()).toBe("todos-chat");

    browse.view.value = at("works");
    await wrapper.vm.$nextTick();
    expect(shown()).toBe("works-chat");
    wrapper.unmount();
  });

  // Closing the overlay is what puts the terminal back in its tile — the cell was never anywhere
  // else, and the session goes on running either way.
  it("gives the cell back to the grid when it goes away", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await wrapper.vm.$nextTick();
    wrapper.unmount();
    expect(shown()).toBeNull();
  });

  it("comes back to the same chat when the overlay opens again", async () => {
    const first = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await first.vm.$nextTick();
    first.unmount();

    const second = mount(CollectionChatPane, { attachTo: document.body });
    await second.vm.$nextTick();
    expect(shown()).toBe("a");
    second.unmount();
  });

  it("keeps both when a second chat starts in the same collection, and shows the new one", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "first");
    file("works", "second");
    await wrapper.vm.$nextTick();
    expect(tabs(wrapper)).toHaveLength(2);
    expect(shown()).toBe("second");
    wrapper.unmount();
  });

  it("moves the claim when another tab is pressed", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "first");
    file("works", "second");
    await wrapper.vm.$nextTick();
    await tabs(wrapper)[0].trigger("click");
    expect(shown()).toBe("first");
    expect(tabs(wrapper)[0].attributes("aria-selected")).toBe("true");
    expect(tabs(wrapper)[1].attributes("aria-selected")).toBe("false");
    wrapper.unmount();
  });

  // It is a grid cell: closing it is the grid's business, and the pane must not offer a second,
  // different way to get rid of a terminal.
  it("offers no hand-off button, because there is nothing to hand off", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("button[title*='Move this']").exists()).toBe(false);
    wrapper.unmount();
  });

  // A tab that only says "something is running" is the half a grid cell never had to say. The dot
  // and the line come from the same sources the cockpit roster reads.
  it("shows whose turn it is, in the grid's own colours", async () => {
    feed.activity.set("a", { working: false, waiting: true, event: "Notification" }); // blocked
    feed.activity.set("b", { working: true, waiting: false, event: null }); // working
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    file("works", "b");
    await wrapper.vm.$nextTick();
    expect(tabs(wrapper)[0].find(".bg-amber").exists()).toBe(true);
    expect(tabs(wrapper)[1].find(".bg-muted").exists()).toBe(true);
    expect(tabs(wrapper)[0].attributes("title")).toContain("waiting on you");
    wrapper.unmount();
  });

  it("says what the agent is doing", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    feed.setTitle("Fixing the failing spec");
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Fixing the failing spec");
    wrapper.unmount();
  });

  // Numbered among its own kind: the strip's position would call the second Claude "Claude 3"
  // whenever another agent sits between them (Codex, PR #2002).
  it("numbers two of the same agent, and leaves a lone one unnumbered", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "c1", "claude");
    file("works", "x", "codex");
    file("works", "c2", "claude");
    await wrapper.vm.$nextTick();
    expect(tabs(wrapper).map((t) => t.text())).toEqual(["Claude 1", "Codex", "Claude 2"]);
    wrapper.unmount();
  });

  // `role="tab"` is a promise about the keyboard (Codex, #2002).
  it("moves between tabs with the arrow keys, and keeps one in the tab order", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "first");
    file("works", "second");
    await wrapper.vm.$nextTick();
    expect(tabs(wrapper).map((t) => t.attributes("tabindex"))).toEqual(["-1", "0"]);

    await tabs(wrapper)[1].trigger("keydown", { key: "ArrowRight" }); // wraps to the first
    expect(shown()).toBe("first");
    await tabs(wrapper)[0].trigger("keydown", { key: "End" });
    expect(shown()).toBe("second");
    await tabs(wrapper)[1].trigger("keydown", { key: "Home" });
    expect(shown()).toBe("first");
    wrapper.unmount();
  });

  it("names the panel its tabs control, and the tab the panel is showing", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "first");
    file("works", "second");
    await wrapper.vm.$nextTick();
    const panel = wrapper.get("[role='tabpanel']");
    expect(tabs(wrapper).map((t) => t.attributes("aria-controls"))).toEqual([panel.attributes("id"), panel.attributes("id")]);
    expect(panel.attributes("aria-labelledby")).toBe(tabs(wrapper)[1].attributes("id"));
    await tabs(wrapper)[0].trigger("click");
    expect(panel.attributes("aria-labelledby")).toBe(tabs(wrapper)[0].attributes("id"));
    wrapper.unmount();
  });

  // A height saved on a taller window is out of range on this one: the pane would eat the
  // collection, and the separator would publish a position past its own maximum.
  it("brings a height saved on another viewport back into range", async () => {
    const viewport = window.innerHeight;
    localStorage.setItem("mt-collection-chat-height", "5000");
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await wrapper.vm.$nextTick();
    const separator = () => wrapper.get("[role='separator']");
    expect(Number(separator().attributes("aria-valuenow"))).toBeLessThanOrEqual(Number(separator().attributes("aria-valuemax")));

    const tall = Number(separator().attributes("aria-valuenow"));
    window.innerHeight = 400; // the window shrank under it
    window.dispatchEvent(new Event("resize"));
    await wrapper.vm.$nextTick();
    expect(Number(separator().attributes("aria-valuenow"))).toBeLessThan(tall);
    expect(Number(separator().attributes("aria-valuenow"))).toBeLessThanOrEqual(Number(separator().attributes("aria-valuemax")));
    wrapper.unmount();
    localStorage.removeItem("mt-collection-chat-height");
    window.innerHeight = viewport;
  });

  // A separator a keyboard can move has to say where it is and how far it goes.
  it("publishes the separator's position and its range", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await wrapper.vm.$nextTick();
    const separator = wrapper.get("[role='separator']");
    const now = Number(separator.attributes("aria-valuenow"));
    const min = Number(separator.attributes("aria-valuemin"));
    const max = Number(separator.attributes("aria-valuemax"));
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThanOrEqual(min);
    expect(now).toBeGreaterThanOrEqual(min);
    await separator.trigger("keydown", { key: "ArrowUp" }); // dragging up grows the terminal
    expect(Number(wrapper.get("[role='separator']").attributes("aria-valuenow"))).toBeGreaterThan(now);
    wrapper.unmount();
  });

  // A cell is sized by whatever holds it — the CSS grid in a tile, `.zoom-main > *` when enlarged.
  // A teleported cell told nothing grows to its CONTENT: measured in the running app, the cell came
  // out 701px tall inside a 286px pane and ran 426px past the bottom of the window, taking the
  // input line with it (reported in use). jsdom lays nothing out, so what can be pinned here is
  // that the receptacle still SAYS it — the three properties `.zoom-main` gives its own child.
  it("tells the cell it teleports in to fit, rather than to grow", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await wrapper.vm.$nextTick();
    const panel = wrapper.get("[role='tabpanel']");
    expect(panel.classes()).toEqual(expect.arrayContaining(["flex", "min-h-0", "flex-1"]));
    expect(panel.classes()).toEqual(expect.arrayContaining(["[&>*]:flex-1", "[&>*]:min-h-0", "[&>*]:min-w-0"]));
    wrapper.unmount();
  });
  // Under the collection or beside it (#2001). The two are one pane read along a different axis, so
  // what has to move with the choice is the size it publishes, the edge the separator is on, and
  // which keys drive it.
  it("docks beside the collection when the button is pressed, and back under it", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await wrapper.vm.$nextTick();
    const separator = () => wrapper.get("[role='separator']");
    const pane = (): HTMLElement => separator().element.parentElement as HTMLElement;
    expect(pane().style.height).not.toBe("");
    expect(pane().style.width).toBe("");
    expect(separator().attributes("aria-orientation")).toBe("horizontal");

    await wrapper.get("button[title*='beside']").trigger("click");
    expect(collectionChatDock.value).toBe("right");
    expect(pane().style.width).not.toBe("");
    expect(pane().style.height).toBe("");
    expect(separator().attributes("aria-orientation")).toBe("vertical");

    await wrapper.get("button[title*='under']").trigger("click");
    expect(pane().style.height).not.toBe("");
    expect(separator().attributes("aria-orientation")).toBe("horizontal");
    wrapper.unmount();
  });

  // A good height under the collection is not a good width beside it, so the two docks remember
  // separately — a shared number would be re-clamped into the other axis' range on every switch.
  it("keeps a size per dock", async () => {
    localStorage.setItem("mt-collection-chat-height", "300");
    localStorage.setItem("mt-collection-chat-width", "500");
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await wrapper.vm.$nextTick();
    const now = (): number => Number(wrapper.get("[role='separator']").attributes("aria-valuenow"));
    expect(now()).toBe(300);

    await wrapper.get("button[title*='beside']").trigger("click");
    expect(now()).toBe(500);
    await wrapper.get("button[title*='under']").trigger("click");
    expect(now()).toBe(300);
    wrapper.unmount();
  });

  // The size of the dock being switched TO was last clamped against the other axis entirely, and
  // may never have been clamped against this window at all.
  it("brings the other dock's size into range when it is switched to", async () => {
    localStorage.setItem("mt-collection-chat-width", "5000");
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await wrapper.vm.$nextTick();
    await wrapper.get("button[title*='beside']").trigger("click");
    const separator = wrapper.get("[role='separator']");
    expect(Number(separator.attributes("aria-valuenow"))).toBeLessThanOrEqual(Number(separator.attributes("aria-valuemax")));
    wrapper.unmount();
  });

  // A vertical bar is driven by Left/Right. Read the axis the other way round and the arrow key
  // walks the separator in the opposite direction from the pointer that just dragged it.
  it("moves the separator with the keys of the axis it is docked on", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await wrapper.vm.$nextTick();
    await wrapper.get("button[title*='beside']").trigger("click");
    const now = (): number => Number(wrapper.get("[role='separator']").attributes("aria-valuenow"));
    const before = now();

    await wrapper.get("[role='separator']").trigger("keydown", { key: "ArrowUp" }); // the other dock's axis
    expect(now()).toBe(before);
    await wrapper.get("[role='separator']").trigger("keydown", { key: "ArrowLeft" }); // dragging left grows the terminal
    expect(now()).toBeGreaterThan(before);
    wrapper.unmount();
  });

  // It moves the whole pane rather than selecting a chat, so it must not be one of the tabs.
  it("keeps the dock button out of the tab strip's roles", async () => {
    const wrapper = mount(CollectionChatPane, { attachTo: document.body });
    file("works", "a");
    await wrapper.vm.$nextTick();
    expect(tabs(wrapper)).toHaveLength(1);
    expect(wrapper.get("button[title*='beside']").attributes("role")).toBeUndefined();
    wrapper.unmount();
  });
});
