// The race this file exists for (#620 F1): the history response is authoritative as of when
// the REQUEST went out, so anything pub/sub delivered while it was in flight has to survive
// it. Driven through the real composable — a pure-function test alone would not prove the
// composable actually remembers what arrived.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
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

const { useSessionFeed } = await import("../../../src/composables/useSessionFeed");

interface Item {
  id: string;
  text: string;
}

// Mount the composable with a history fetch we control the timing of.
function mountFeed(respond: () => Promise<{ ok: boolean; json?: () => Promise<unknown> }>) {
  const items = ref<Item[]>([]);
  const sessionId = ref<string | null>("s1");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(respond));
  const wrapper = mount(
    defineComponent({
      setup() {
        useSessionFeed<Item>(items, {
          sessionId: () => sessionId.value,
          historyUrl: (id) => `/api/history/${id}`,
          historyKey: "items",
          channel: (id) => `feed:${id}`,
          identify: (item) => item.id,
        });
        return () => h("div");
      },
    }),
  );
  return { items, sessionId, wrapper };
}

const deliver = (channel: string, item: Item) => handlers.get(channel)?.(item);

beforeEach(() => {
  handlers.clear();
  vi.unstubAllGlobals();
});

describe("useSessionFeed", () => {
  it("shows the history it fetched", async () => {
    const { items } = mountFeed(async () => ({ ok: true, json: async () => ({ items: [{ id: "a", text: "A" }] }) }));
    await vi.waitFor(() => expect(items.value).toEqual([{ id: "a", text: "A" }]));
  });

  // THE bug: a tool call that fires while the pane is loading used to disappear the moment
  // the response landed, and stay gone until a reload.
  it("keeps an item that arrived while the history was in flight", async () => {
    let release!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const { items } = mountFeed(() => new Promise((resolve) => (release = resolve)));
    await nextTick();

    deliver("feed:s1", { id: "live", text: "arrived mid-flight" });
    expect(items.value.map((i) => i.id)).toEqual(["live"]);

    release({ ok: true, json: async () => ({ items: [{ id: "a", text: "A" }] }) });
    await vi.waitFor(() => expect(items.value.map((i) => i.id)).toEqual(["a", "live"]));
  });

  // The same hole in the failure path: losing the history must not take the live events too.
  it("keeps live arrivals when the history request fails", async () => {
    let reject!: (reason: Error) => void;
    const { items } = mountFeed(() => new Promise((_, r) => (reject = r)));
    await nextTick();

    deliver("feed:s1", { id: "live", text: "arrived mid-flight" });
    reject(new Error("offline"));
    // Flush rather than poll: waitFor would pass on the state BEFORE the catch ran, so the
    // wipe this guards against would never be observed.
    await flushPromises();
    await flushPromises();

    expect(items.value.map((i) => i.id)).toEqual(["live"]);
  });

  it("lets the live copy win when the history also has that item", async () => {
    let release!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const { items } = mountFeed(() => new Promise((resolve) => (release = resolve)));
    await nextTick();

    deliver("feed:s1", { id: "a", text: "newer" });
    release({ ok: true, json: async () => ({ items: [{ id: "a", text: "older" }] }) });

    await vi.waitFor(() => expect(items.value).toEqual([{ id: "a", text: "newer" }]));
  });
});
