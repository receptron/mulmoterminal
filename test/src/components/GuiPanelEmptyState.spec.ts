import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import GuiPanel from "../../../src/components/GuiPanel.vue";
import { TOOL_GROUPS, toolsInGroup } from "../../../common/toolGroups";

// The empty Canvas is the only place the GUI tools are named, so the list is the feature's
// documentation. It named two of the four, and a user reading it had no way to learn that a chart
// or a web page was also on offer.
vi.mock("../../../src/composables/usePubSub", () => ({ usePubSub: () => ({ subscribe: () => () => {} }) }));

// The panel asks the SERVER which tools this session has (/api/tools) rather than rebuilding the
// list from the group table: a grid cell reaches only its registered groups, and a plugin whose
// requiredEnv is unmet is dropped at load. `tools: null` stands for a request that never answers.
const mockServer = (tools: string[] | null) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/tools")) {
        if (tools === null) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, json: async () => ({ tools: tools.map((toolName) => ({ toolName, title: toolName })) }) };
      }
      return { ok: true, json: async () => ({ toolResults: [] }) };
    }),
  );
};

const mountPanel = () => mount(GuiPanel, { props: { sessionId: "s1", sendTextMessage: () => true }, global: { stubs: { PluginFrame: true } } });
const itemsOf = (w: ReturnType<typeof mountPanel>) => w.findAll('[data-testid="canvas-empty"] li').map((li) => li.text());

beforeEach(() => {
  mockServer(TOOL_GROUPS.flatMap(toolsInGroup));
});

describe("the canvas pane's empty state", () => {
  // Compared against the group table rather than a list repeated here: a copy would go stale in
  // exactly the way this test exists to catch.
  it("names every tool the session actually has", async () => {
    const tools = [...toolsInGroup("render"), ...toolsInGroup("media")];
    mockServer(tools);
    const w = mountPanel();
    await flushPromises();
    const items = itemsOf(w);
    expect(tools.length).toBeGreaterThan(1);
    expect(items).toHaveLength(tools.length);
    for (const tool of tools) expect(items.some((item) => item.includes(tool))).toBe(true);
  });

  // The switches in the launcher are per group, so a list that mixes them gives no clue which one
  // to turn on for a tool that isn't there.
  it("names the group each tool came from once there is more than one", async () => {
    mockServer([...toolsInGroup("render"), ...toolsInGroup("media")]);
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="canvas-empty"]').text()).toContain("media");
  });

  // Whatever the terminal registered, and nothing else: a cell without the media group told to
  // ask for generateImage is being sent to a tool its agent was never handed.
  it("lists only what the server offered", async () => {
    mockServer(toolsInGroup("render"));
    const w = mountPanel();
    await flushPromises();
    const items = itemsOf(w);
    expect(items.some((item) => item.includes("presentHtml"))).toBe(true);
    expect(items.some((item) => item.includes("generateImage"))).toBe(false);
  });

  // The case the static group table gets wrong on its own: searchX / readXPost are dropped at
  // load when X_BEARER_TOKEN is absent, so the group's OTHER members must still list without them.
  it("leaves out a group member the server withheld", async () => {
    mockServer(["presentHtml", "google"]);
    const w = mountPanel();
    await flushPromises();
    const items = itemsOf(w);
    expect(items.some((item) => item.includes("google"))).toBe(true);
    expect(items.some((item) => item.includes("searchX"))).toBe(false);
  });

  // A session that reached data / external tools can be asked for those in the same
  // conversation, and this list is the only place they are named.
  it("lists the non-drawing groups too when the session has them", async () => {
    const w = mountPanel();
    await flushPromises();
    const items = itemsOf(w);
    expect(items.some((item) => item.includes("manageCollection"))).toBe(true);
    expect(items.some((item) => item.includes("searchX"))).toBe(true);
  });

  // "No tools" and "not asked yet" are different answers. An unreachable /api/tools is our
  // failure, and answering it with an empty pane blames the session for it.
  it("falls back to the full list when the server cannot be asked", async () => {
    mockServer(null);
    const w = mountPanel();
    await flushPromises();
    expect(itemsOf(w)).toHaveLength(TOOL_GROUPS.flatMap(toolsInGroup).length);
  });

  // "Ask Claude to use one of these:" above an EMPTY list is a dead end.
  it("drops the hint rather than heading an empty list when the session has no tools", async () => {
    mockServer([]);
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="canvas-empty"]').exists()).toBe(false);
    expect(w.find('[data-testid="canvas-no-tools"]').exists()).toBe(true);
    expect(w.text()).not.toContain("presentDocument");
  });

  // Naming a tool says nothing about what asking for it would get.
  it("says what each one produces", async () => {
    const w = mountPanel();
    await flushPromises();
    for (const item of itemsOf(w)) expect(item.length).toBeGreaterThan("presentDocument".length + 4);
  });

  it("is replaced once something has been drawn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/tools")) return { ok: true, json: async () => ({ tools: [] }) };
        return { ok: true, json: async () => ({ toolResults: [{ uuid: "u1", toolName: "presentHtml", data: {} }] }) };
      }),
    );
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="canvas-empty"]').exists()).toBe(false);
  });
});
