import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import GuiPanel from "../../../src/components/GuiPanel.vue";
import { CANVAS_TOOL_GROUP, toolsInGroup } from "../../../common/toolGroups";

// The empty Canvas is the only place the drawing tools are named, so the list is the feature's
// documentation. It named two of the four, and a user reading it had no way to learn that a chart
// or a web page was also on offer.
vi.mock("../../../src/composables/usePubSub", () => ({ usePubSub: () => ({ subscribe: () => () => {} }) }));

const mountPanel = () => mount(GuiPanel, { props: { sessionId: "s1", sendTextMessage: () => true }, global: { stubs: { PluginFrame: true } } });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ toolResults: [] }) })),
  );
});

describe("the canvas pane's empty state", () => {
  // Compared against the group table rather than a list repeated here: a copy would go stale in
  // exactly the way this test exists to catch.
  it("names every tool in the render group", async () => {
    const w = mountPanel();
    await flushPromises();
    const items = w.findAll('[data-testid="canvas-empty"] li').map((li) => li.text());
    const tools = toolsInGroup(CANVAS_TOOL_GROUP);
    expect(tools.length).toBeGreaterThan(1);
    expect(items).toHaveLength(tools.length);
    for (const tool of tools) expect(items.some((item) => item.includes(tool))).toBe(true);
  });

  // Naming a tool says nothing about what asking for it would get.
  it("says what each one produces", async () => {
    const w = mountPanel();
    await flushPromises();
    const items = w.findAll('[data-testid="canvas-empty"] li').map((li) => li.text());
    for (const item of items) expect(item.length).toBeGreaterThan("presentDocument".length + 4);
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
