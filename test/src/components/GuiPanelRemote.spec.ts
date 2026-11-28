// #3506. A remote cell's Canvas reads its cards on its host and hears new ones on the Mac-side channel
// the relay follows. A card is drawn from what its plugin's `onRemote` rule hands the view, which
// dispatches to that host; a card with no rule is listed by name. A view's change of state is not
// written back, since that route is the agent's own. A local panel is the control.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, inject } from "vue";
import { PLUGIN_HOST_KEY } from "../../../src/composables/pluginRuntime";
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

type Announcement = { host: string | null; sessionId: string };
const announce = vi.hoisted(() => ({ listener: null as ((announcement: Announcement) => void) | null }));
vi.mock("../../../src/composables/useToolGroupsAnnounce", () => ({
  onToolGroupsAnnounced: (listener: (a: Announcement) => void) => {
    announce.listener = listener;
  },
}));

const projectLookups = vi.hoisted(() => ({ cwds: [] as (string | null)[] }));
vi.mock("../../../src/composables/collectionProject", () => ({
  cachedProjectIdForCwd: () => undefined,
  projectIdForCwd: async (cwd: string | null) => {
    projectLookups.cwds.push(cwd);
    return null;
  },
}));

const StubView = defineComponent({
  name: "StubView",
  props: { selectedResult: { type: Object, required: true } },
  emits: ["updateResult"],
  setup(props, { emit }) {
    return () => h("button", { class: "stub-view", onClick: () => emit("updateResult", { viewState: { n: 1 } }) }, String(props.selectedResult.uuid));
  },
});

// A view with a rule of its own: it shows the result the rule handed it, and the host its dispatch goes to.
const HostView = defineComponent({
  name: "HostView",
  props: { selectedResult: { type: Object, required: true } },
  setup(props) {
    const host = inject(PLUGIN_HOST_KEY, () => "unset");
    return () => h("div", { class: "host-view" }, `${String(props.selectedResult.title)}@${String(host())}`);
  },
});

vi.mock("../../../src/plugins-registry", () => ({
  getPlugin: (toolName: string) => {
    if (toolName === "presentForm") return { toolName, viewComponent: StubView, onRemote: (result: unknown) => result };
    if (toolName === "presentDocument") return { toolName, viewComponent: StubView };
    if (toolName === "presentHtml")
      return {
        toolName,
        viewComponent: HostView,
        onRemote: (result: { title?: string }, host: string) => ({ ...result, title: `${result.title} on ${host}` }),
      };
    return undefined;
  },
}));

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

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const CARDS = [
  { uuid: "form-1", toolName: "presentForm", data: {} },
  { uuid: "doc-1", toolName: "presentDocument", title: "plan.md", data: {} },
  { uuid: "page-1", toolName: "presentHtml", title: "page", data: {} },
];
let asked: { url: string; method: string }[] = [];

beforeEach(() => {
  asked = [];
  handlers.clear();
  projectLookups.cwds = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      asked.push({ url, method: init?.method ?? "GET" });
      const body = url.includes("toolResults") ? { toolResults: CARDS } : { tools: [{ toolName: "presentForm" }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});

const mountPanel = (host: string | null) =>
  mount(GuiPanel, { props: { sessionId: SESSION, cwd: "/srv/p", host, sendTextMessage: () => true }, attachTo: document.body });

describe("a remote cell's Canvas", () => {
  it("reads its cards and tools on its host, and listens on the Mac-side channel", async () => {
    mountPanel("lx");
    await flushPromises();
    expect(asked.map((r) => r.url).sort()).toEqual([`/remote/lx/api/agent/toolResults/${SESSION}`, `/remote/lx/api/tools?sessionId=${SESSION}`]);
    expect([...handlers.keys()]).toEqual([`remote:lx:session:${SESSION}`]);
  });

  it("draws a card that draws from its result alone, and lists the rest by name", async () => {
    const w = mountPanel("lx");
    await flushPromises();
    expect(w.findAll(".stub-view").map((v) => v.text())).toEqual(["form-1"]);
    const listed = w.findAll('[data-testid="canvas-remote-card"]');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.text()).toContain("plan.md");
    expect(listed[0]?.text()).toContain("lx");
  });

  it("hands a view the result its rule makes for the host, and the host its dispatch goes to", async () => {
    const w = mountPanel("lx");
    await flushPromises();
    expect(w.findAll(".host-view").map((v) => v.text())).toEqual(["page on lx@lx"]);
  });

  it("draws a card that arrives live, through the relay", async () => {
    const w = mountPanel("lx");
    await flushPromises();
    handlers.get(`remote:lx:session:${SESSION}`)?.({ uuid: "form-2", toolName: "presentForm", data: {} });
    await flushPromises();
    expect(w.findAll(".stub-view").map((v) => v.text())).toEqual(["form-1", "form-2"]);
  });

  it("keeps a view's change of state on screen without writing it back, and looks up no project here", async () => {
    const w = mountPanel("lx");
    await flushPromises();
    await w.find(".stub-view").trigger("click");
    await flushPromises();
    expect(asked.filter((r) => r.method === "POST")).toEqual([]);
    expect(projectLookups.cwds).toEqual([]);
  });

  it("is re-asked on its host by that host's tool-groups announcement, and not by this machine's", async () => {
    mountPanel("lx");
    await flushPromises();
    const before = asked.length;
    announce.listener?.({ host: null, sessionId: SESSION });
    announce.listener?.({ host: "other", sessionId: SESSION });
    await flushPromises();
    expect(asked).toHaveLength(before);
    announce.listener?.({ host: "lx", sessionId: SESSION });
    await flushPromises();
    expect(asked.slice(before).map((r) => r.url)).toEqual([`/remote/lx/api/tools?sessionId=${SESSION}`]);
  });
});

describe("a local Canvas (control)", () => {
  it("reads here, draws every card, writes a view's state back and scopes to the project", async () => {
    const w = mountPanel(null);
    await flushPromises();
    expect(asked.map((r) => r.url).sort()).toEqual([`/api/agent/toolResults/${SESSION}`, `/api/tools?sessionId=${SESSION}`]);
    expect([...handlers.keys()]).toEqual([`session:${SESSION}`]);
    expect(w.findAll(".stub-view").map((v) => v.text())).toEqual(["form-1", "doc-1"]);
    expect(w.findAll(".host-view").map((v) => v.text())).toEqual(["page@null"]);
    expect(w.find('[data-testid="canvas-remote-card"]').exists()).toBe(false);
    await w.find(".stub-view").trigger("click");
    await flushPromises();
    expect(asked.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/agent/toolResult"]);
    expect(projectLookups.cwds).toEqual(["/srv/p"]);
  });
});
