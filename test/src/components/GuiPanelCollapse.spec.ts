// The Canvas showed one card per tool CALL, so editing a collection over several turns buried the
// current one under its own history — each card is 80vh, so every edit pushed it a full pane down,
// and the panel never scrolled itself.
//
// canvasCollapse.spec.ts pins the rule and canvasIdentity.spec.ts pins the keys; this drives the
// panel itself, because neither proves GuiPanel actually applies them — or that a re-presented card
// keeps its component instance rather than being torn down and rebuilt on every edit.
import { describe, it, expect, vi, beforeEach } from "vitest";
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

// jsdom gives every element zero height, so the auto-follow gate can't be exercised without
// saying how tall the container is.
function stubScrollMetrics(element: Element, { scrollHeight = 1000, clientHeight = 400 } = {}) {
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
}

beforeEach(() => {
  handlers.clear();
  viewMounts = 0;
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
    // The owner's decision, and the reason the auto-follow below can just go to the bottom.
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

  it("reuses the view instance across a re-presentation instead of remounting it", async () => {
    // Keyed on identity, not uuid: a remount would throw away whatever the view holds — the
    // table's scroll position, its expanded rows — on every single edit.
    const wrapper = mountPanel();
    await flushPromises();
    await push(collapsing("c1", "books"));
    expect(viewMounts).toBe(1);
    await push(collapsing("c2", "books"));
    expect(viewMounts).toBe(1);
    expect(rendered(wrapper)).toEqual(["c2"]);
  });
});

describe("GuiPanel — following the newest card", () => {
  it("scrolls to the bottom when a card arrives", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const scroller = wrapper.get('[data-testid="canvas-scroll"]').element;
    stubScrollMetrics(scroller);
    await push(plain("p1"));
    await nextTick();
    expect(scroller.scrollTop).toBe(1000);
  });

  it("stays put when the reader has scrolled up to look at an earlier card", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const scroller = wrapper.get('[data-testid="canvas-scroll"]');
    stubScrollMetrics(scroller.element);
    scroller.element.scrollTop = 0;
    await scroller.trigger("scroll");
    await push(plain("p1"));
    await nextTick();
    expect(scroller.element.scrollTop).toBe(0);
  });

  it("resumes following once the reader scrolls back to the bottom", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const scroller = wrapper.get('[data-testid="canvas-scroll"]');
    stubScrollMetrics(scroller.element);
    scroller.element.scrollTop = 0;
    await scroller.trigger("scroll");
    scroller.element.scrollTop = 600; // 1000 - 600 - 400 = 0, within the tolerance band
    await scroller.trigger("scroll");
    await push(plain("p1"));
    await nextTick();
    expect(scroller.element.scrollTop).toBe(1000);
  });

  it("does not chase a view persisting its own state", async () => {
    // onUpdateResult replaces the result object but keeps its uuid; following that would fight
    // someone typing in a form.
    const wrapper = mountPanel();
    await flushPromises();
    await push(plain("p1"));
    const scroller = wrapper.get('[data-testid="canvas-scroll"]');
    stubScrollMetrics(scroller.element);
    scroller.element.scrollTop = 0;
    await scroller.trigger("scroll");
    scroller.element.scrollTop = 600;
    await scroller.trigger("scroll");
    scroller.element.scrollTop = 250; // reader moved inside the card, gate now closed
    await scroller.trigger("scroll");
    await push({ uuid: "p1", toolName: "plain", data: {}, viewState: { typed: "x" } });
    await nextTick();
    expect(scroller.element.scrollTop).toBe(250);
  });
});
