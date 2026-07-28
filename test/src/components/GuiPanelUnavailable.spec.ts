import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import GuiPanel from "../../../src/components/GuiPanel.vue";

// The Canvas pane outlives the cell it was opened on: walking the zoom lands it on a launcher
// with no session, or on a directory whose agent has no drawing tools. Its normal empty state
// says "ask Claude to use presentDocument" — an instruction that cannot be followed in either
// case, which is worse than saying nothing.
vi.mock("../../../src/composables/usePubSub", () => ({ usePubSub: () => ({ subscribe: () => () => {} }) }));

const mountPanel = (props: Record<string, unknown> = {}) =>
  mount(GuiPanel, { props: { sessionId: null, sendTextMessage: () => true, ...props }, global: { stubs: { PluginFrame: true } } });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ toolResults: [] }) })),
  );
});

describe("the canvas pane's unavailable states", () => {
  it("keeps the ask-Claude hint when the panel is usable", async () => {
    const w = mountPanel({ sessionId: "s1" });
    await flushPromises();
    expect(w.find('[data-testid="canvas-unavailable"]').exists()).toBe(false);
    expect(w.text()).toContain("presentDocument");
  });

  // A launcher / command cell. There is no agent to ask, so the hint names a conversation that
  // cannot happen.
  it("says there is no session rather than telling you to ask an agent that isn't there", async () => {
    const w = mountPanel({ unavailable: "no-session" });
    await flushPromises();
    expect(w.find('[data-testid="canvas-unavailable"]').exists()).toBe(true);
    expect(w.text()).toContain("No session here");
    expect(w.text()).not.toContain("presentDocument");
  });

  // The tools were never registered for this directory, so asking would fail every time.
  it("names the directory's missing render MCP, and how to fix it", async () => {
    const w = mountPanel({ sessionId: "s1", unavailable: "no-render-mcp" });
    await flushPromises();
    const text = w.text();
    expect(text).toContain("not enabled for this directory");
    expect(text).toContain("CANVAS (render MCPs)");
    expect(text).toContain("restart");
    expect(text).not.toContain("presentDocument");
  });

  // A view left over from the previous cell rendered under an "unavailable" heading would
  // contradict it outright.
  it("shows no plugin views while unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ toolResults: [{ uuid: "u1", toolName: "presentDocument", data: {} }] }) })),
    );
    const w = mountPanel({ sessionId: "s1", unavailable: "no-render-mcp" });
    await flushPromises();
    expect(w.find(".frame").exists()).toBe(false);
    expect(w.find('[data-testid="canvas-unavailable"]').exists()).toBe(true);
  });
});
