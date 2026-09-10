// A filing restored from storage is WATCHED, not just displayed (#2001).
//
// Nothing calls `holdCollectionChat` on a reload, and that is the call which arms the listener for
// the server's `closed` push and the settle check. Without arming them at load, a chat restored
// into the pane could never be retired — it would sit there as a dead, still-actionable tab until
// somebody happened to start another chat (Codex, PR #2002). These cases pin that it IS armed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { COLLECTION_CHATS_KEY } from "../../../src/composables/collectionChatStorage";

const bus = vi.hoisted((): { push: (data: unknown) => void; connect: () => void; subscribed: number } => ({
  push: () => {},
  connect: () => {},
  subscribed: 0,
}));
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (_channel: string, callback: (data: unknown) => void) => {
      bus.push = callback;
      bus.subscribed += 1;
      return () => {};
    },
    onConnect: (callback: () => void) => {
      bus.connect = callback;
      return () => {};
    },
  }),
}));
// The grid, still silent: what these cases are about is the SESSION channel, and a grid that had
// answered would retire the restored chat for the other reason.
vi.mock("../../../src/composables/collectionTerminalClaim", () => ({ gridSessionIds: { value: null } }));

const RESTORED = "workspace|collection:works";
const stored = (id: string) => JSON.stringify({ [RESTORED]: { sessions: [{ id, agent: "claude", draft: false }], activeId: id } });

/** The module, evaluated fresh — the restore happens at import time, so each case needs its own. */
async function loadWith(raw: string) {
  localStorage.setItem(COLLECTION_CHATS_KEY, raw);
  bus.subscribed = 0;
  vi.resetModules();
  return import("../../../src/composables/collectionChatSessions");
}

beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("offline"))),
  ),
);
afterEach(() => {
  localStorage.removeItem(COLLECTION_CHATS_KEY);
  vi.unstubAllGlobals();
});

describe("a filing restored across a reload", () => {
  it("comes back, filed where it was", async () => {
    const filing = await loadWith(stored("restored"));
    expect(filing.collectionChatsFor(RESTORED).sessions.map((s) => s.id)).toEqual(["restored"]);
    expect(filing.collectionChatCount()).toBe(1);
  });

  it("is listening for the server's endings", async () => {
    const filing = await loadWith(stored("restored"));
    expect(bus.subscribed).toBe(1);
    bus.push({ id: "restored", event: "closed" });
    expect(filing.collectionChatCount()).toBe(0);
  });

  it("re-checks on the first connect, without waiting for a new chat", async () => {
    await loadWith(stored("restored"));
    bus.connect();
    expect(vi.mocked(fetch)).toHaveBeenCalled(); // it asked /api/sessions/live about the restored id
  });

  it("arms nothing when there was nothing stored", async () => {
    const filing = await loadWith("{}");
    expect(filing.collectionChatCount()).toBe(0);
    expect(bus.subscribed).toBe(0);
  });
});
