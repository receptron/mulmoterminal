import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, effectScope } from "vue";
import { flushPromises } from "@vue/test-utils";

const subscribers = new Map<string, (data: unknown) => void>();

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, handler: (data: unknown) => void) => {
      subscribers.set(channel, handler);
      return () => subscribers.delete(channel);
    },
    onReconnect: () => {},
  }),
}));

import { useSessionFeed } from "../../../src/composables/useSessionFeed";

interface Row {
  id: string;
  text: string;
}

const HISTORY_ROW: Row = { id: "from-history", text: "an older tool call" };
const LIVE_ROW: Row = { id: "from-live", text: "fired while loading" };

// A history response that this test decides when to resolve, so an event can be delivered
// while the request is still out — the window the bug lives in.
function deferredHistory(rows: Row[]) {
  let resolve!: () => void;
  const gate = new Promise<void>((r) => (resolve = r));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await gate;
      return { ok: true, json: async () => ({ rows }) };
    }),
  );
  return { answer: resolve };
}

function mountFeed(sessionId = "session-1") {
  const items = ref<Row[]>([]);
  const scope = effectScope();
  scope.run(() =>
    useSessionFeed<Row>(items, {
      sessionId: () => sessionId,
      historyUrl: (id) => `/api/history/${id}`,
      historyKey: "rows",
      channel: (id) => `feed:${id}`,
      identify: (row) => row.id,
    }),
  );
  return { items, scope, deliver: (row: Row) => subscribers.get(`feed:${sessionId}`)?.(row) };
}

const ids = (rows: Row[]) => rows.map((row) => row.id);

beforeEach(() => subscribers.clear());
afterEach(() => vi.unstubAllGlobals());

describe("useSessionFeed", () => {
  // The regression: the pane subscribes before the history lands, so an event can arrive
  // while the request is out. Assigning the response wholesale erased it, and nothing
  // brought it back until the pane reloaded (#620 F1).
  it("keeps an event that arrived while the history was loading", async () => {
    const { answer } = deferredHistory([HISTORY_ROW]);
    const { items, deliver } = mountFeed();

    deliver(LIVE_ROW);
    expect(ids(items.value)).toEqual(["from-live"]);

    answer();
    await flushPromises();
    expect(ids(items.value)).toEqual(["from-history", "from-live"]);
  });

  it("still shows the history it fetched", async () => {
    const { answer } = deferredHistory([HISTORY_ROW]);
    const { items } = mountFeed();
    answer();
    await flushPromises();
    expect(ids(items.value)).toEqual(["from-history"]);
  });

  // A re-emitted item is the same row moving on, not a second one.
  it("lets an event update the history row it belongs to", async () => {
    const { answer } = deferredHistory([HISTORY_ROW]);
    const { items, deliver } = mountFeed();

    deliver({ id: "from-history", text: "now finished" });
    answer();
    await flushPromises();
    expect(items.value).toEqual([{ id: "from-history", text: "now finished" }]);
  });

  // Losing the history is not a reason to lose an event that belongs to this session.
  it("keeps a live event when the history request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { items, deliver } = mountFeed();
    deliver(LIVE_ROW);
    await flushPromises();
    expect(ids(items.value)).toEqual(["from-live"]);
  });

  it("keeps a live event when the history request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { items, deliver } = mountFeed();
    deliver(LIVE_ROW);
    await flushPromises();
    expect(ids(items.value)).toEqual(["from-live"]);
  });

  it("appends events that arrive after the history has landed", async () => {
    const { answer } = deferredHistory([HISTORY_ROW]);
    const { items, deliver } = mountFeed();
    answer();
    await flushPromises();

    deliver(LIVE_ROW);
    expect(ids(items.value)).toEqual(["from-history", "from-live"]);
  });
});
