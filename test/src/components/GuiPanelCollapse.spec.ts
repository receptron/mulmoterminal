// The Canvas showed one card per tool CALL, so editing a collection over several turns buried the
// current one under its own history — each card is 80vh, so every edit pushed it a full pane down,
// and the panel never scrolled itself.
//
// canvasCollapse.spec.ts pins the rule and canvasIdentity.spec.ts pins the keys; this drives the
// panel itself, because neither proves GuiPanel actually applies them — or that a re-presented card
// keeps its component instance rather than being torn down and rebuilt on every edit.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";

const handlers = new Map<string, (data: unknown) => void>();
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, handler: (data: unknown) => void) => {
      handlers.set(channel, handler);
      return () => handlers.delete(channel);
    },
  }),
}));

vi.mock("../../../src/composables/useToolGroupsAnnounce", () => ({ onToolGroupsAnnounced: () => {} }));

// Counts every mount of a card's view, so "the instance was REUSED" is observable rather than
// inferred from the rendered output (which looks identical either way).
let viewMounts = 0;
const StubView = defineComponent({
  name: "StubView",
  props: { selectedResult: { type: Object, required: true } },
  setup(props) {
    viewMounts += 1;
    return () => h("div", { class: "stub-view", "data-uuid": props.selectedResult.uuid }, String(props.selectedResult.uuid));
  },
});

// A registry with just the two tools this file needs: one that collapses (by a `data.key`) and one
// that does not, so the opt-out default is exercised alongside the new behaviour.
vi.mock("../../../src/plugins-registry", () => ({
  getPlugin: (toolName: string) => {
    if (toolName === "collapsing") {
      return { toolName, viewComponent: StubView, identityOf: (r: { data?: { key?: string } }) => r.data?.key ?? null };
    }
    if (toolName === "plain") return { toolName, viewComponent: StubView };
    return undefined;
  },
}));

// PluginFrame puts each view in a Shadow DOM, which hides it from the queries below and has
// nothing to do with what is being tested.
vi.mock("../../../src/components/PluginFrame.vue", () => ({
  default: defineComponent({
    name: "PluginFrameStub",
    setup:
      (_p, { slots }) =>
      () =>
        h("div", { class: "frame" }, slots.default?.()),
  }),
}));

const GuiPanel = (await import("../../../src/components/GuiPanel.vue")).default;

function mountPanel() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes("/api/tools") ? { tools: [] } : { toolResults: [] }),
    })),
  );
  return mount(GuiPanel, { props: { sessionId: "s1", sendTextMessage: () => true } });
}

// Deliver a result the way the server does — on the session channel.
async function push(result: unknown) {
  handlers.get("session:s1")?.(result);
  await flushPromises();
  await nextTick();
}

const collapsing = (uuid: string, key: string) => ({ uuid, toolName: "collapsing", data: { key } });
const plain = (uuid: string) => ({ uuid, toolName: "plain", data: {} });
const rendered = (wrapper: ReturnType<typeof mountPanel>) => wrapper.findAll(".stub-view").map((v) => v.attributes("data-uuid"));

// jsdom lays nothing out — every element reports zero height and a zero rect — so the follow logic
// has no geometry to read. Rather than stamping rects onto elements (which are rebuilt on every
// push, so the stamps would have to be re-applied before each one, including inside the watcher's
// own nextTick), the layout is COMPUTED at call time from the container's current children: cards
// stack in order, and the pane is a fixed viewport onto them.
//
// Cards default to TALLER than the pane, which is the case that matters: it is the shape of a long
// presentDocument, where "scroll to the bottom" lands the reader at the last line of something they
// have not started reading. `setCardHeights` overrides that for the short-card cases.
const CARD_PX = 500;
const PANE_PX = 400;

let cardHeights: number[] = [];
const heightOfCard = (index: number) => cardHeights[index] ?? CARD_PX;
/** The `scrollTop` at which card `index` sits flush with the top of the pane. */
const topOfCard = (index: number) => {
  let top = 0;
  for (let i = 0; i < index; i += 1) top += heightOfCard(i);
  return top;
};
/** Per-card heights, in order. Any card past the end keeps the default. */
const setCardHeights = (heights: number[]) => {
  cardHeights = heights;
};

function installLayout() {
  const rectAt = (top: number, height: number) =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    // Reached through the PARENT, not a document lookup: @vue/test-utils mounts outside
    // `document`, so `document.querySelector` finds nothing and every rect silently comes back at
    // zero — which reads exactly like "the panel never scrolled" and passes a bottom-anchored
    // assertion by accident.
    const parent = this.parentElement;
    if (!parent || parent.dataset.testid !== "canvas-scroll") return rectAt(0, 0);
    // Viewport coordinates: a card's document-space top, minus how far the pane is scrolled.
    const index = Array.prototype.indexOf.call(parent.children, this);
    if (index < 0) return rectAt(0, 0);
    return rectAt(topOfCard(index) - parent.scrollTop, heightOfCard(index));
  };
}

/** The furthest the pane can actually scroll, which is where a clamped jump lands. */
const furthestScroll = (element: Element) => Math.max(0, element.scrollHeight - PANE_PX);

/** Size the pane itself. Called once per mount — the container element survives every push. */
function stubPane(element: Element) {
  Object.defineProperty(element, "scrollHeight", { get: () => topOfCard(element.children.length), configurable: true });
  Object.defineProperty(element, "clientHeight", { value: PANE_PX, configurable: true });
  // scrollTop CLAMPS, as a browser's does. jsdom implements no scrolling, so it stores whatever it
  // is assigned — and an out-of-range assignment reading back verbatim is precisely what hid the
  // clamp bug this harness now covers: the panel appeared to reach a position no real browser
  // would let it reach. Assignments in these tests are therefore bounded by the layout, same as a
  // user's scrolling would be.
  let scrollTop = 0;
  Object.defineProperty(element, "scrollTop", {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = Math.max(0, Math.min(next, furthestScroll(element)));
    },
    configurable: true,
  });
}

const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  handlers.clear();
  viewMounts = 0;
  setCardHeights([]);
  installLayout();
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
});

describe("GuiPanel — collapsing repeated cards", () => {
  it("shows one card when the same subject is presented twice", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await push(collapsing("c1", "books"));
    await push(collapsing("c2", "books"));
    expect(rendered(wrapper)).toEqual(["c2"]);
  });

  it("keeps distinct subjects as separate cards", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await push(collapsing("c1", "books"));
    await push(collapsing("f1", "films"));
    expect(rendered(wrapper)).toEqual(["c1", "f1"]);
  });

  it("moves a re-presented card to the bottom, past what arrived while it sat above", async () => {
    // The owner's decision, and what makes the newest card the one the follow below anchors on.
    const wrapper = mountPanel();
    await flushPromises();
    await push(collapsing("c1", "books"));
    await push(plain("p1"));
    await push(collapsing("c2", "books"));
    expect(rendered(wrapper)).toEqual(["p1", "c2"]);
  });

  it("never collapses a tool that declares no identity", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await push(plain("p1"));
    await push(plain("p2"));
    expect(rendered(wrapper)).toEqual(["p1", "p2"]);
  });

  it("remounts the view on a re-presentation, so the card refetches", async () => {
    // The v-for key is the UUID, not the identity, and this is why. A re-presented card exists to
    // show state that CHANGED, and the views have no other way to learn that: the collection View
    // reloads from a `watch(activeSlug, …)` that a same-slug re-present never fires, and
    // MulmoTerminal does not configure the package's optional `subscribeChanges` hook. Keying on
    // the identity keeps the instance — and its STALE contents — which is a card that collapsed to
    // "the newest" while rendering the oldest. Reported live and caught by Codex on PR #1223.
    const wrapper = mountPanel();
    await flushPromises();
    await push(collapsing("c1", "books"));
    expect(viewMounts).toBe(1);
    await push(collapsing("c2", "books"));
    expect(viewMounts).toBe(2);
    expect(rendered(wrapper)).toEqual(["c2"]);
  });

  it("does NOT remount a card just because a view persisted its own state", async () => {
    // The other half of the rule above: onUpdateResult replaces the result object but keeps its
    // uuid, so the key is stable and a form does not lose what is being typed into it.
    mountPanel();
    await flushPromises();
    await push(plain("p1"));
    expect(viewMounts).toBe(1);
    await push({ uuid: "p1", toolName: "plain", data: {}, viewState: { typed: "x" } });
    expect(viewMounts).toBe(1);
  });
});

describe("GuiPanel — following the newest card", () => {
  const paneOf = (wrapper: ReturnType<typeof mountPanel>) => {
    const pane = wrapper.get('[data-testid="canvas-scroll"]');
    stubPane(pane.element);
    return pane;
  };

  it("lands on the newest card's TOP, not the bottom of the pane", async () => {
    // The whole point. A long presentDocument flows at its natural height, so the bottom of the
    // pane is the END of the document — the reader dropped at the last line of something they
    // have not started. Two 500px cards in a 400px pane: the bottom would be 600
    // (scrollHeight - clientHeight); the top of card 2 is 500.
    const wrapper = mountPanel();
    await flushPromises();
    const pane = paneOf(wrapper);
    await push(plain("p1"));
    await push(plain("p2"));
    await nextTick();
    expect(pane.element.scrollTop).toBe(topOfCard(1));
    expect(pane.element.scrollTop).not.toBe(pane.element.scrollHeight - PANE_PX);
  });

  it("shows the first card from its beginning", async () => {
    // A card taller than the pane must still open at line one, not at its end.
    const wrapper = mountPanel();
    await flushPromises();
    const pane = paneOf(wrapper);
    await push(plain("p1"));
    await nextTick();
    expect(pane.element.scrollTop).toBe(topOfCard(0));
  });

  it("stays put when the reader has scrolled up to an earlier card", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const pane = paneOf(wrapper);
    await push(plain("p1"));
    await push(plain("p2"));
    await nextTick();
    pane.element.scrollTop = 0; // back up into card 1
    await pane.trigger("scroll");
    await push(plain("p3"));
    await nextTick();
    expect(pane.element.scrollTop).toBe(0);
  });

  it("keeps following while the reader is reading DOWN inside the newest card", async () => {
    // Being partway through the newest card is not "I have scrolled away" — a bottom-relative
    // gate would have read it as exactly that and stopped following.
    const wrapper = mountPanel();
    await flushPromises();
    const pane = paneOf(wrapper);
    await push(plain("p1"));
    await push(plain("p2"));
    await nextTick();
    pane.element.scrollTop = topOfCard(1) + 100; // further down inside card 2, and reachable
    await pane.trigger("scroll");
    await push(plain("p3"));
    await nextTick();
    expect(pane.element.scrollTop).toBe(topOfCard(2));
  });

  it("resumes following once the reader comes back down to the newest card", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const pane = paneOf(wrapper);
    await push(plain("p1"));
    await push(plain("p2"));
    await nextTick();
    pane.element.scrollTop = 0;
    await pane.trigger("scroll");
    pane.element.scrollTop = topOfCard(1);
    await pane.trigger("scroll");
    await push(plain("p3"));
    await nextTick();
    expect(pane.element.scrollTop).toBe(topOfCard(2));
  });

  // A newest card SHORTER than the pane, sitting under tall earlier content, has a top edge beyond
  // the furthest the pane can scroll. Cards of 800 then 100 in a 400 pane: total 900, so the
  // furthest scroll is 500, while the newest card's top is at 800.
  const SHORT_NEWEST = [800, 100];

  it("clamps the jump to the furthest the pane can scroll, so a short newest card is fully visible", async () => {
    setCardHeights(SHORT_NEWEST);
    const wrapper = mountPanel();
    await flushPromises();
    const pane = paneOf(wrapper);
    await push(plain("p1"));
    await push(plain("p2"));
    await nextTick();
    expect(pane.element.scrollTop).toBe(furthestScroll(pane.element));
    expect(pane.element.scrollTop).toBeLessThan(topOfCard(1));
  });

  it("keeps following after a clamped jump, which the reader never asked for", async () => {
    // The gate has to compare against the REACHABLE position, not the card's top edge. Comparing
    // against the top edge makes the pane's own jump (which lands short of it) read as the reader
    // having scrolled up, and following switches off for someone who never touched anything —
    // so the NEXT card is silently not followed. Caught by Codex on PR #1224.
    setCardHeights(SHORT_NEWEST);
    const wrapper = mountPanel();
    await flushPromises();
    const pane = paneOf(wrapper);
    await push(plain("p1"));
    await push(plain("p2"));
    await nextTick();
    // jsdom does not emit `scroll` for a programmatic scrollTop, so stand in for the browser: this
    // is the event the jump above would really have produced, and the one that used to close the gate.
    await pane.trigger("scroll");
    await push(plain("p3"));
    await nextTick();
    expect(pane.element.scrollTop).toBe(topOfCard(2));
  });

  // A result whose tool has no registered viewComponent stays in the feed forever while drawing
  // nothing. It must not count as "the newest card" — it has no position to anchor on, so the
  // follow would have nothing to measure. Flagged by CodeRabbit on PR #1224.
  const unrenderable = (uuid: string) => ({ uuid, toolName: "no-such-plugin", data: {} });

  it("follows past a result no plugin can render", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const pane = paneOf(wrapper);
    await push(plain("p1"));
    await push(plain("p2"));
    await push(unrenderable("u1"));
    await push(plain("p3"));
    await nextTick();
    expect(rendered(wrapper)).toEqual(["p1", "p2", "p3"]);
    expect(pane.element.scrollTop).toBe(topOfCard(2));
  });

  it("still lets the reader disengage while an unrenderable result is the newest", async () => {
    // The gate has to keep updating. Anchored on a card with no element it would bail out of
    // onScroll entirely, freezing following ON, and the next card would yank the reader away.
    const wrapper = mountPanel();
    await flushPromises();
    const pane = paneOf(wrapper);
    await push(plain("p1"));
    await push(plain("p2"));
    await push(unrenderable("u1"));
    pane.element.scrollTop = 0; // back up into card 1
    await pane.trigger("scroll");
    await push(plain("p3"));
    await nextTick();
    expect(pane.element.scrollTop).toBe(0);
  });

  it("does not chase a view persisting its own state", async () => {
    // onUpdateResult replaces the result object but keeps its uuid; following that would fight
    // someone typing in a form.
    const wrapper = mountPanel();
    await flushPromises();
    const pane = paneOf(wrapper);
    await push(plain("p1"));
    await push(plain("p2"));
    await nextTick();
    pane.element.scrollTop = topOfCard(1) + 50; // reading inside the newest card
    await pane.trigger("scroll");
    await push({ uuid: "p2", toolName: "plain", data: {}, viewState: { typed: "x" } });
    await nextTick();
    expect(pane.element.scrollTop).toBe(topOfCard(1) + 50);
  });
});
