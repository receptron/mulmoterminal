import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { parseCollectionTarget, type NotifierEntry } from "../../../src/composables/useNotifications";

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

describe("parseCollectionTarget", () => {
  it("parses slug + selected itemId", () => {
    expect(parseCollectionTarget("/collections/todo?selected=item-1")).toEqual({ slug: "todo", itemId: "item-1" });
  });

  it("parses a bare slug with no record", () => {
    expect(parseCollectionTarget("/collections/todo")).toEqual({ slug: "todo", itemId: undefined });
  });

  it("decodes percent-encoded slug + itemId", () => {
    expect(parseCollectionTarget("/collections/my%20col?selected=a%2Fb")).toEqual({ slug: "my col", itemId: "a/b" });
  });

  it("ignores unrelated query params and keeps selected", () => {
    expect(parseCollectionTarget("/collections/todo?selected=x&notificationId=y")).toEqual({ slug: "todo", itemId: "x" });
  });

  it("does not double-decode a selected id containing a literal percent", () => {
    // URLSearchParams already decodes %25%20 → "% ". A second decodeURIComponent
    // would throw "URI malformed" on the resulting "100% done".
    expect(parseCollectionTarget("/collections/annual?selected=100%25%20done")).toEqual({ slug: "annual", itemId: "100% done" });
  });

  it("returns itemId undefined when there is a query but no selected", () => {
    expect(parseCollectionTarget("/collections/todo?foo=bar")).toEqual({ slug: "todo", itemId: undefined });
  });

  it("returns null for a slug with malformed percent-encoding (non-actionable, no throw)", () => {
    expect(parseCollectionTarget("/collections/%E0%A4%A")).toBeNull();
    expect(parseCollectionTarget("/collections/%E0%A4%A?selected=x")).toBeNull();
  });

  it("returns null for a non-collection target", () => {
    expect(parseCollectionTarget("/documents/abc")).toBeNull();
  });

  it("returns null for an empty slug", () => {
    expect(parseCollectionTarget("/collections/")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseCollectionTarget(undefined)).toBeNull();
  });
});

// The bell's list is fetched whole, and the channel keeps changing it while that request is
// out — including clearing an entry the response still lists. Applying the response as-is
// brought a dismissed notification back (#620 F2).
describe("useNotifications — the list fetched while the channel is live", () => {
  const entry = (id: string, title: string): NotifierEntry => ({
    id,
    pluginPkg: "test",
    severity: "info",
    title,
    createdAt: "2026-07-22T00:00:00Z",
  });

  const BELL = entry("n1", "Build finished");
  const OTHER = entry("n2", "Review requested");

  // The module keeps `active` and its initialised flag in module scope, so each case needs
  // its own copy to say anything about what a fresh page does.
  const freshModule = async () => {
    vi.resetModules();
    return import("../../../src/composables/useNotifications");
  };

  // A list request this test decides when to answer, so an event can be delivered while it
  // is still out — the window the bug lives in.
  function deferredList(active: NotifierEntry[]) {
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        return { ok: true, json: async () => ({ active }) };
      }),
    );
    return { answer };
  }

  const deliver = (event: unknown) => subscribers.get("notifications")?.(event);

  beforeEach(() => subscribers.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not bring back a notification cleared while the list was loading", async () => {
    const { answer } = deferredList([BELL, OTHER]);
    const { useNotifications } = await freshModule();
    const { active } = useNotifications();

    deliver({ type: "cleared", id: "n1" });
    answer();
    await flushPromises();

    expect(active.value.map((e) => e.id)).toEqual(["n2"]);
  });

  it("keeps a notification published while the list was loading", async () => {
    const { answer } = deferredList([BELL]);
    const { useNotifications } = await freshModule();
    const { active } = useNotifications();

    deliver({ type: "published", entry: OTHER });
    answer();
    await flushPromises();

    expect(active.value.map((e) => e.id)).toEqual(["n1", "n2"]);
  });

  it("takes an update that landed while the list was loading", async () => {
    const { answer } = deferredList([BELL]);
    const { useNotifications } = await freshModule();
    const { active } = useNotifications();

    deliver({ type: "updated", entry: entry("n1", "Build failed") });
    answer();
    await flushPromises();

    expect(active.value.map((e) => e.title)).toEqual(["Build failed"]);
  });

  // Order is the answer: cleared-then-published leaves the entry, and the reverse does not.
  it("replays what happened in the order it happened", async () => {
    const { answer } = deferredList([BELL]);
    const { useNotifications } = await freshModule();
    const { active } = useNotifications();

    deliver({ type: "cleared", id: "n1" });
    deliver({ type: "published", entry: entry("n1", "Build finished again") });
    answer();
    await flushPromises();

    expect(active.value.map((e) => e.title)).toEqual(["Build finished again"]);
  });

  it("shows the fetched list when nothing happened meanwhile", async () => {
    const { answer } = deferredList([BELL, OTHER]);
    const { useNotifications } = await freshModule();
    const { active } = useNotifications();

    answer();
    await flushPromises();

    expect(active.value.map((e) => e.id)).toEqual(["n1", "n2"]);
  });
});
