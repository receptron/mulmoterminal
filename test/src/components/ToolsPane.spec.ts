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

  // The empty state is where someone who expected a tool ends up, so it has to say where tools come
  // from — and BOTH halves of that, because the switch is on an empty cell's launch form (not on
  // screen while this session runs) and the registration is read when a session starts. Naming one
  // without the other sends the reader hunting for a control that is not there (#1966).
  it("tells the reader where tools come from when there are none", async () => {
    mockFetch((url) => Promise.resolve(jsonRes(url.startsWith("/api/tools") ? { tools: [] } : { toolCalls: [] })));
    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    const empty = wrapper.find('[data-testid="tools-empty"]').text();
    expect(empty).toContain("launch form");
    expect(empty).toContain("when it starts");
    // The switches' own labels, so the sentence and the control agree on what to look for.
    ["Workspace data", "Canvas", "External accounts"].forEach((heading) => expect(empty).toContain(heading));
  });

  // The pane mounts BEFORE the first response, and it is re-asked whenever the cell changes — so
  // "empty" has to mean "still asking" until an answer arrives, or the pane reports the PREVIOUS
  // session's answer as this one's (Codex on #1966, the third door into "an empty list is not
  // evidence").
  //
  // The second load is what this asserts, deliberately. `immediate: true` makes the watcher assign
  // "loading" before anything can observe the ref's initial value, so a test that only covers the
  // first request passes whatever that initial value is — which is how the first version of this
  // test could not fail.
  it("does not claim anything while a request is in flight", async () => {
    const held: Array<(value: unknown) => void> = [];
    let pend = false;
    mockFetch((url) => {
      if (!url.startsWith("/api/tools")) return Promise.resolve(jsonRes({ toolCalls: [] }));
      return pend ? new Promise<unknown>((resolve) => held.push(resolve)) : Promise.resolve(jsonRes({ tools: [] }));
    });
    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="tools-empty"]').exists()).toBe(true); // answered: none

    // Another cell. Until IT answers, the previous answer must not stand in for it.
    pend = true;
    await wrapper.setProps({ sessionId: "b" });
    await flushPromises();
    expect(wrapper.find('[data-testid="tools-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="tools-empty"]').exists()).toBe(false);

    expect(held).toHaveLength(1); // the second request IS in flight, so the gap under test is real
    held.forEach((resolve) => resolve(jsonRes({ tools: [] })));
    await flushPromises();
    expect(wrapper.find('[data-testid="tools-empty"]').exists()).toBe(true);
  });

  // Switching cells re-asks, and until the answer lands the pane was still showing the PREVIOUS
  // session's tools — as this session's. The `loading` state cannot cover it: that branch is
  // guarded on an empty list, and this list is not empty (#1968).
  it("does not show the previous session's tools while the new one is still being asked", async () => {
    const held: Array<(value: unknown) => void> = [];
    let pend = false;
    mockFetch((url) => {
      if (!url.startsWith("/api/tools")) return Promise.resolve(jsonRes({ toolCalls: [] }));
      return pend ? new Promise<unknown>((resolve) => held.push(resolve)) : Promise.resolve(jsonRes({ tools: [{ toolName: "presentDocument" }] }));
    });
    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-name"]').text()).toBe("presentDocument");

    pend = true;
    await wrapper.setProps({ sessionId: "b" });
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-name"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="tools-loading"]').exists()).toBe(true);

    held.forEach((resolve) => resolve(jsonRes({ tools: [{ toolName: "presentChart" }] })));
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-name"]').text()).toBe("presentChart");
  });

  // The same gate, one field over: `guiOnlyHistory` draws a note about the AGENT whose history is
  // shown ("reports no hooks…"). Carried across a switch it describes the wrong agent, which is
  // the stale-list bug wearing a different hat (#1968).
  it("does not describe the previous session's agent while the new one is still being asked", async () => {
    const held: Array<(value: unknown) => void> = [];
    let pend = false;
    mockFetch((url) => {
      if (!url.startsWith("/api/tools")) return Promise.resolve(jsonRes({ toolCalls: [] }));
      return pend ? new Promise<unknown>((resolve) => held.push(resolve)) : Promise.resolve(jsonRes({ tools: [], guiOnlyHistory: true }));
    });
    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="gui-only-note"]').exists()).toBe(true);

    pend = true;
    await wrapper.setProps({ sessionId: "b" });
    await flushPromises();
    expect(wrapper.find('[data-testid="gui-only-note"]').exists()).toBe(false);

    held.forEach((resolve) => resolve(jsonRes({ tools: [], guiOnlyHistory: false })));
    await flushPromises();
    expect(wrapper.find('[data-testid="gui-only-note"]').exists()).toBe(false);
  });

  // The other half of the pairing, and the reason it is a pairing rather than a clear-on-switch:
  // a session re-asks when the server announces its groups, and blanking the pane for that would
  // throw away a good answer we already have (#1968).
  it("keeps the tools it has while the SAME session is re-asked", async () => {
    const held: Array<(value: unknown) => void> = [];
    let pend = false;
    mockFetch((url) => {
      if (!url.startsWith("/api/tools")) return Promise.resolve(jsonRes({ toolCalls: [] }));
      return pend ? new Promise<unknown>((resolve) => held.push(resolve)) : Promise.resolve(jsonRes({ tools: [{ toolName: "presentDocument" }] }));
    });
    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-name"]').text()).toBe("presentDocument");

    // The server announces this session's groups, which re-asks for the SAME session.
    pend = true;
    capturedGroups?.({ sessionId: "a", groups: ["render"] });
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-name"]').text()).toBe("presentDocument");

    held.forEach((resolve) => resolve(jsonRes({ tools: [{ toolName: "presentChart" }] })));
    await flushPromises();
    expect(wrapper.find('[data-testid="tool-name"]').text()).toBe("presentChart");
  });

  // An empty list from a FAILED request is not evidence that nothing is registered, and the
  // guidance above would send the reader to fix a folder that may be configured fine. The file
  // already reasons this way one field over — `guiOnlyHistory` resets on failure with "Unknown, so
  // claim nothing" (CodeRabbit on #1966).
  it("says it could not ask, rather than blaming the config, when the request fails", async () => {
    mockFetch((url) => (url.startsWith("/api/tools") ? Promise.reject(new Error("offline")) : Promise.resolve(jsonRes({ toolCalls: [] }))));
    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="tools-unknown"]').text()).toContain("Could not ask this server");
    expect(wrapper.find('[data-testid="tools-empty"]').exists()).toBe(false);
  });

  // A 200 whose body is not the shape the route promises — a proxy's error page, a truncated
  // response — reaches here as `{}` from `jsonBody`. Every success path of `/api/tools` sends the
  // array, so its absence is "unreadable", not "none" (Codex on #1966).
  it("treats a 200 with no tools array as unreadable, not as an empty configuration", async () => {
    mockFetch((url) => Promise.resolve(jsonRes(url.startsWith("/api/tools") ? {} : { toolCalls: [] })));
    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="tools-unknown"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="tools-empty"]').exists()).toBe(false);
  });

  // An array that arrives and yields nothing is the same class one layer down: the route sends
  // well-formed summaries, so entries this rejects came from a proxy or a version skew. Saying
  // "none are enabled" there sends the reader to fix a folder that is fine (Codex on #1966).
  it("treats a tools array whose entries are all unusable as unreadable", async () => {
    mockFetch((url) => Promise.resolve(jsonRes(url.startsWith("/api/tools") ? { tools: [{}, { nope: 1 }] } : { toolCalls: [] })));
    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="tools-unknown"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="tools-empty"]').exists()).toBe(false);
  });

  // …but a genuinely empty array is still the answer it looks like, or the guidance could never
  // appear at all.
  it("keeps an empty array as a real answer", async () => {
    mockFetch((url) => Promise.resolve(jsonRes(url.startsWith("/api/tools") ? { tools: [] } : { toolCalls: [] })));
    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="tools-empty"]').exists()).toBe(true);
  });

  // …and the guidance comes back once a request succeeds with nothing in it, so a transient
  // failure does not leave the pane stuck on "could not ask".
  it("returns to the guidance after a failed request is followed by an empty one", async () => {
    let fail = true;
    mockFetch((url) => {
      if (!url.startsWith("/api/tools")) return Promise.resolve(jsonRes({ toolCalls: [] }));
      return fail ? Promise.reject(new Error("offline")) : Promise.resolve(jsonRes({ tools: [] }));
    });
    const wrapper = mount(ToolsPane, { props: { sessionId: "a" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="tools-unknown"]').exists()).toBe(true);

    fail = false;
    capturedGroups?.({ sessionId: "a", groups: ["render"] });
    await flushPromises();
    expect(wrapper.find('[data-testid="tools-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="tools-unknown"]').exists()).toBe(false);
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
