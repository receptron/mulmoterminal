import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import GuiPanel from "../../../src/components/GuiPanel.vue";
import { TOOL_GROUPS, toolsInGroup, type ToolGroup } from "../../../common/toolGroups";

// The empty Canvas is the only place the GUI tools are named, so the list is the feature's
// documentation. It named two of the four, and a user reading it had no way to learn that a chart
// or a web page was also on offer.
vi.mock("../../../src/composables/usePubSub", () => ({ usePubSub: () => ({ subscribe: () => () => {} }) }));

const mountPanel = (groups?: ToolGroup[]) =>
  mount(GuiPanel, { props: { sessionId: "s1", sendTextMessage: () => true, groups }, global: { stubs: { PluginFrame: true } } });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ toolResults: [] }) })),
  );
});

const itemsOf = (w: ReturnType<typeof mountPanel>) => w.findAll('[data-testid="canvas-empty"] li').map((li) => li.text());

describe("the canvas pane's empty state", () => {
  // Compared against the group table rather than a list repeated here: a copy would go stale in
  // exactly the way this test exists to catch.
  it("names every tool in the session's groups", async () => {
    const w = mountPanel(["render", "media"]);
    await flushPromises();
    const items = itemsOf(w);
    const tools = [...toolsInGroup("render"), ...toolsInGroup("media")];
    expect(tools.length).toBeGreaterThan(1);
    expect(items).toHaveLength(tools.length);
    for (const tool of tools) expect(items.some((item) => item.includes(tool))).toBe(true);
  });

  // The switches are per group, so a list that mixes them gives no clue which one to turn on.
  it("names the group each tool came from once there is more than one", async () => {
    const w = mountPanel(["render", "media"]);
    await flushPromises();
    expect(w.find('[data-testid="canvas-empty"]').text()).toContain("media");
  });

  // Whatever the terminal registered, and nothing else: a cell without the media group told to
  // ask for generateImage is being sent to a tool its agent was never handed.
  it("lists only the groups this session has", async () => {
    const w = mountPanel(["render"]);
    await flushPromises();
    const items = itemsOf(w);
    expect(items.some((item) => item.includes("presentHtml"))).toBe(true);
    expect(items.some((item) => item.includes("generateImage"))).toBe(false);
  });

  // A session that reached data / external tools can be asked for those in the same
  // conversation, and this list is the only place they are named.
  it("lists the non-drawing groups too when the session has them", async () => {
    const w = mountPanel(["render", "data", "external"]);
    await flushPromises();
    const items = itemsOf(w);
    expect(items.some((item) => item.includes("manageCollection"))).toBe(true);
    expect(items.some((item) => item.includes("searchX"))).toBe(true);
  });

  // The single view connects on the all-tools URL, where no group was ever selected.
  it("falls back to every group when the caller names none", async () => {
    const w = mountPanel();
    await flushPromises();
    expect(itemsOf(w)).toHaveLength(TOOL_GROUPS.flatMap(toolsInGroup).length);
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
      vi.fn(async () => ({ ok: true, json: async () => ({ toolResults: [{ uuid: "u1", toolName: "presentHtml", data: {} }] }) })),
    );
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="canvas-empty"]').exists()).toBe(false);
  });
});
