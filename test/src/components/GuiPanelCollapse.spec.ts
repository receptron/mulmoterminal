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

// A registry with just the three tools this file needs: one that collapses (by a `data.key`), one
// that does not — so the opt-out default is exercised alongside the new behaviour — and one that
// uses the REAL file-path accessor, which is the only way to see that the panel hands it the
// registered stories roots (#1976).
vi.mock("../../../src/plugins-registry", async () => {
  const { filePathIdentity } = await import("../../../src/utils/canvasIdentity");
  return {
    getPlugin: (toolName: string) => {
      if (toolName === "collapsing") {
        return { toolName, viewComponent: StubView, identityOf: (r: { data?: { key?: string } }) => r.data?.key ?? null };
      }
      if (toolName === "story") return { toolName, viewComponent: StubView, identityOf: filePathIdentity };
      if (toolName === "plain") return { toolName, viewComponent: StubView };
      return undefined;
    },
  };
});

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

const { activeCollectionProjectId } = await import("../../../src/composables/collectionSurface");
const { useAppConfig } = await import("../../../src/composables/useAppConfig");
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

/** The panel with a directory, i.e. the shape the grid actually renders. The project list is
 *  answered too, so the scope resolves — asynchronously, which is the point of the test below. */
function mountPanelIn(cwd: string) {
  const body = (url: string): unknown => {
    if (url.includes("/api/collection-projects")) return { projects: [{ id: "proj-1", label: "proj", cwd }] };
    if (url.includes("/api/tools")) return { tools: [] };
    return { toolResults: [] };
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({ ok: true, json: async () => body(url) })),
  );
  return mount(GuiPanel, { props: { sessionId: "s1", sendTextMessage: () => true, cwd } });
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
  // A module-level singleton, so a root left behind here would decide the next file's cards too.
  useAppConfig().storiesRoots.value = [];
});

describe("GuiPanel — collapsing repeated cards", () => {
  it("shows one card when the same subject is presented twice", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await push(collapsing("c1", "books"));
    await push(collapsing("c2", "books"));
    expect(rendered(wrapper)).toEqual(["c2"]);
  });

  // A result whose tool has no registered renderer is skipped rather than drawn as an empty frame,
  // and must not take the cards around it down with it. This is the branch that used to be the
  // template's `v-if="getPlugin(...)"` (#1231).
  it("skips a result whose tool has no plugin, and still draws the rest", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await push(plain("p1"));
    await push({ uuid: "unknown1", toolName: "notRegistered", data: {} });
    await push(plain("p2"));
    expect(rendered(wrapper)).toEqual(["p1", "p2"]);
    expect(wrapper.findAll(".frame")).toHaveLength(2);
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

  // A card SELF-FETCHES its collection by slug, and which project that resolves to is the
  // PANEL's scope — the canvas shows one session's cards, and that session has a directory.
  // Without this the fetch went to the workspace and a collection living in the session's own
  // folder came back "not found" while the tool call had succeeded.
  it("scopes collection requests to the session's directory while it is open", async () => {
    const panel = mountPanelIn("/proj");
    await flushPromises();
    expect(activeCollectionProjectId()).toBe("proj-1");
    // …and gives the scope back when it goes away, so the next surface is not left holding it.
    panel.unmount();
    expect(activeCollectionProjectId()).toBeNull();
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

// The panel is where a card's wire path meets the directories it has to be read against: the
// accessor is pure and the roots are a singleton ref, so nothing but a mounted panel shows that the
// two were actually joined up.
describe("GuiPanel — one deck, whichever spelling reached it", () => {
  const WS = "/Users/me/w";
  const throughRoot = (uuid: string) => ({ uuid, toolName: "story", data: { filePath: "stories/decks/x.json", root: "W", script: {} } });
  const byAbsolutePath = (uuid: string) => ({ uuid, toolName: "story", data: { filePath: `${WS}/decks/x.json`, script: {} } });

  it("collapses the two spellings of one deck", async () => {
    useAppConfig().storiesRoots.value = [{ id: "W", canonical: WS, paths: [WS] }];
    const wrapper = mountPanel();
    await flushPromises();
    await push(throughRoot("s1"));
    await push(byAbsolutePath("s2"));
    expect(rendered(wrapper)).toEqual(["s2"]);
  });

  // The panel opens before `/api/config` lands, and cards can arrive in that window. Until the
  // roots are known the wire path names no file, so the two stand apart — and the moment the config
  // arrives they collapse, without the cards being re-sent.
  it("re-collapses when the config arrives", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await push(throughRoot("s1"));
    await push(byAbsolutePath("s2"));
    expect(rendered(wrapper)).toEqual(["s1", "s2"]);

    useAppConfig().storiesRoots.value = [{ id: "W", canonical: WS, paths: [WS] }];
    await nextTick();
    expect(rendered(wrapper)).toEqual(["s2"]);
  });

  // Two decks that merely share a wire tail under different roots are still two cards — the guard
  // #1933 added, now held by the paths the roots resolve to.
  it("keeps two roots' identically-named decks apart", async () => {
    useAppConfig().storiesRoots.value = [
      { id: "W", canonical: WS, paths: [WS] },
      { id: "P", canonical: `${WS}/proj`, paths: [`${WS}/proj`] },
    ];
    const wrapper = mountPanel();
    await flushPromises();
    await push({ uuid: "w1", toolName: "story", data: { filePath: "stories/deck.json", root: "W", script: {} } });
    await push({ uuid: "p1", toolName: "story", data: { filePath: "stories/deck.json", root: "P", script: {} } });
    expect(rendered(wrapper)).toEqual(["w1", "p1"]);
  });
});
