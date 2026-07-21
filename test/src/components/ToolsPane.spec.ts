import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ToolsPane from "../../../src/components/ToolsPane.vue";

// Capture the pub/sub callback so tests can simulate a server push without a
// real socket (mirrors Sidebar.spec.ts).
let captured: ((data: unknown) => void) | null = null;
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (_channel: string, cb: (data: unknown) => void) => {
      captured = cb;
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
  return { promise, resolve };
}

// Route fetch by URL so /api/tools and /api/tool-calls/:id can return distinct
// (and individually controllable) responses.
function mockFetch(handler: (url: string) => Promise<unknown>) {
  globalThis.fetch = vi.fn((url: string) => handler(String(url))) as unknown as typeof fetch;
}

describe("ToolsPane", () => {
  beforeEach(() => {
    captured = null;
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
});
