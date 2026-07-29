import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ToolsPane from "../../../src/components/ToolsPane.vue";

// Capture the pub/sub callbacks so tests can simulate a server push without a real socket
// (mirrors Sidebar.spec.ts). Kept per channel: the pane subscribes twice — its history feed, and
// the tool-groups announcement that tells it to re-ask what tools this session has.
let captured: ((data: unknown) => void) | null = null;
let capturedGroups: ((data: unknown) => void) | null = null;
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, cb: (data: unknown) => void) => {
      if (channel === "tool-groups") capturedGroups = cb;
      else captured = cb;
      return () => {};
    },
  }),
}));

function jsonRes(body: unknown) {
  return { ok: true, json: async () => body };
}

// A promise whose resolution we control from the test.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  // `settled` is the test's own flag for "we have moved past the phase this gate stands in", so a
  // fetch stub can answer differently before and after without a second gate.
  return { promise, resolve, settled: false };
}

// Route fetch by URL so /api/tools and /api/tool-calls/:id can return distinct
// (and individually controllable) responses.
function mockFetch(handler: (url: string) => Promise<unknown>) {
  globalThis.fetch = vi.fn((url: string) => handler(String(url))) as unknown as typeof fetch;
}

describe("ToolsPane", () => {
  beforeEach(() => {
    captured = null;
    capturedGroups = null;
  });

  it("lists available tools and renders history rows with running/completed/failed badges", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/tools")) {
        return Promise.resolve(jsonRes({ tools: [{ toolName: "presentDocument", description: "Render markdown" }] }));
      }
      return Promise.resolve(
        jsonRes({
          toolCalls: [
            { toolUseId: "t1", toolName: "Bash", status: "completed", at: 1, durationMs: 5, toolOutput: "ok" },
            { toolUseId: "t2", toolName: "Read", status: "running", at: 2 },
            { toolUseId: "t3", toolName: "Edit", status: "failed", at: 3, toolOutput: "boom" },
          ],
        }),
      );
    });

    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();

    expect(wrapper.find('[data-testid="tool-name"]').text()).toBe("presentDocument");
    expect(wrapper.findAll('[data-testid="tool-call"]')).toHaveLength(3);
    expect(wrapper.find('[data-testid="badge-done"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="badge-running"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="badge-failed"]').exists()).toBe(true);
  });

  it("completes a running call in place when a pub/sub push arrives (deduped by tool_use_id)", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/tools")) return Promise.resolve(jsonRes({ tools: [] }));
      return Promise.resolve(jsonRes({ toolCalls: [{ toolUseId: "t1", toolName: "Bash", status: "running", at: 1 }] }));
    });

    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="badge-running"]').exists()).toBe(true);

    // Server pushes the completion for the same tool_use_id.
    captured?.({ toolUseId: "t1", toolName: "Bash", status: "completed", at: 1, durationMs: 9, toolOutput: "ok" });
    await flushPromises();

    expect(wrapper.findAll('[data-testid="tool-call"]')).toHaveLength(1); // updated in place, not appended
    expect(wrapper.find('[data-testid="badge-running"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="badge-done"]').exists()).toBe(true);
  });

  it("drops a stale history response when the session changes mid-flight", async () => {
    const aGate = deferred<undefined>();
    mockFetch((url) => {
      if (url.startsWith("/api/tools")) return Promise.resolve(jsonRes({ tools: [] }));
      if (url.includes("/api/tool-calls/a")) {
        // Session A's history stays pending until we release the gate.
        return aGate.promise.then(() => jsonRes({ toolCalls: [{ toolUseId: "old", toolName: "OldTool", status: "completed", at: 1 }] }));
      }
      return Promise.resolve(jsonRes({ toolCalls: [{ toolUseId: "new", toolName: "NewTool", status: "completed", at: 2 }] }));
    });

    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    // Switch to B before A resolves; B resolves immediately.
    await wrapper.setProps({ sessionId: "b" });
    await flushPromises();
    expect(wrapper.text()).toContain("NewTool");

    // A's response arrives late — it must NOT overwrite B's pane.
    aGate.resolve(undefined);
    await flushPromises();
    expect(wrapper.text()).toContain("NewTool");
    expect(wrapper.text()).not.toContain("OldTool");
  });

  // The pane asks what tools a session has while the agent is still starting, so the first answer
  // is "none" — and it used to stand there until something remounted the pane. That is the
  // "No GUI plugin tools enabled." a freshly launched session showed until it was redrawn.
  it("re-asks for the tool list when the server announces this session's groups", async () => {
    let toolsReply: unknown[] = [];
    mockFetch((url) => Promise.resolve(jsonRes(url.startsWith("/api/tools") ? { tools: toolsReply } : { toolCalls: [] })));

    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.text()).toContain("No GUI plugin tools enabled.");

    // The agent's MCP client has now connected, so the server knows what it has.
    toolsReply = [{ toolName: "presentDocument", description: "Render markdown" }];
    capturedGroups?.({ sessionId: "a", groups: ["render"] });
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-name"]').text()).toBe("presentDocument");

    // Another session's announcement must not repoint this pane.
    toolsReply = [{ toolName: "manageCollection" }];
    capturedGroups?.({ sessionId: "b", groups: ["data"] });
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-name"]').text()).toBe("presentDocument");
  });

  // Since the re-ask there are routinely two /api/tools loads in flight for the SAME session — the
  // early one asked at mount and the one the announcement triggered. A session-id guard passes both,
  // so an older reply landing second would restore the empty list the re-ask exists to get rid of.
  it("drops an older tools reply that lands after the re-ask's", async () => {
    const earlyGate = deferred<undefined>();
    mockFetch((url) => {
      if (!url.startsWith("/api/tools")) return Promise.resolve(jsonRes({ toolCalls: [] }));
      // The first load hangs; the one the announcement triggers answers straight away.
      return earlyGate.settled
        ? Promise.resolve(jsonRes({ tools: [{ toolName: "presentDocument" }], guiOnlyHistory: true }))
        : earlyGate.promise.then(() => jsonRes({ tools: [], guiOnlyHistory: false }));
    });

    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    earlyGate.settled = true;
    capturedGroups?.({ sessionId: "a", groups: ["render"] });
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-name"]').text()).toBe("presentDocument");

    // The pre-announcement reply arrives late. It must not put the empty list back.
    earlyGate.resolve(undefined);
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-name"]').text()).toBe("presentDocument");
    expect(wrapper.find('[data-testid="gui-only-note"]').exists()).toBe(true);
  });

  // A broker-fed history holds ONLY the GUI tools. An empty list there means "called no GUI tool",
  // not "did nothing" — without the note the pane looks identical to a claude session's and is read
  // as the stronger claim. The SERVER decides it: a codex launcher chip carries no agent name the
  // client could key off.
  it("says the history is GUI-tools-only when the server reports it", async () => {
    mockFetch((url) => Promise.resolve(jsonRes(url.startsWith("/api/tools") ? { tools: [], guiOnlyHistory: true } : { toolCalls: [] })));

    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="gui-only-note"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("No GUI tool calls yet.");
  });

  it("stays quiet for a hook-fed history, and when the tools request fails", async () => {
    mockFetch((url) => Promise.resolve(jsonRes(url.startsWith("/api/tools") ? { tools: [], guiOnlyHistory: false } : { toolCalls: [] })));
    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="gui-only-note"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("No tool calls yet.");

    // A failed /api/tools must not leave the note behind claiming something about a history we
    // could not ask about.
    globalThis.fetch = vi.fn((url: string) =>
      String(url).startsWith("/api/tools") ? Promise.reject(new Error("offline")) : Promise.resolve(jsonRes({ toolCalls: [] })),
    ) as unknown as typeof fetch;
    await wrapper.setProps({ sessionId: "b" });
    await flushPromises();
    expect(wrapper.find('[data-testid="gui-only-note"]').exists()).toBe(false);
  });
});
