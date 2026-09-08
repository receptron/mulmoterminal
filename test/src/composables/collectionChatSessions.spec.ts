// @vitest-environment node
// What a chat started from a collection is filed under (#2001).
//
// The key is the whole design: the first version filed nothing and tied the session to the OVERLAY,
// which is why the pane stayed open after switching collections and why going to the grid and back
// left nothing to return to.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// The filing keeps itself honest off the server's own session channel, and tears a terminal slot
// down when it does. Both are played by hand here.
const bus = vi.hoisted((): { push: (data: unknown) => void; connect: () => void; subscribed: number; listening: number } => ({
  push: () => {},
  connect: () => {},
  subscribed: 0,
  listening: 0,
}));
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (_channel: string, callback: (data: unknown) => void) => {
      bus.push = callback;
      bus.subscribed += 1;
      bus.listening += 1;
      return () => (bus.listening -= 1);
    },
    onConnect: (callback: () => void) => {
      bus.connect = callback;
      return () => {};
    },
  }),
}));

import {
  forgetEndedChat,
  activateCollectionChat,
  collectionChatCount,
  collectionChatsFor,
  dropCollectionChat,
  holdCollectionChat,
  resetCollectionChats,
} from "../../../src/composables/collectionChatSessions";
import { collectionChatKey } from "../../../src/composables/collectionChatKey";
import type { SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";

const request = (id: string): SpawnedChatRequest => ({ id, agent: "claude", draft: false });

/** What `/api/sessions/live` answers, or null for a request that fails outright. */
let served: unknown = null;
/** What the route says it CONSIDERED — null to echo everything it was sent. */
let consider: unknown = null;
/** A chat is not checked until it has had time to register server-side; see SPAWN_SETTLE_MS. */
const SETTLE_MS = 10_000;
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(1);
};
/** Move past the grace, which also fires the settle check the filing schedules for itself. */
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
};

describe("filing a collection's chats", () => {
  const works = collectionChatKey({ mode: "detail", kind: "collection", slug: "works" }, null) ?? "";
  const todos = collectionChatKey({ mode: "detail", kind: "collection", slug: "todos" }, null) ?? "";
  const ids = (key: string): string[] => collectionChatsFor(key).sessions.map((session) => session.id);

  beforeEach(() => {
    vi.useFakeTimers();
    resetCollectionChats();
    bus.subscribed = 0;
    bus.listening = 0;
    served = null;
    consider = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (served === null) return Promise.reject(new Error("offline"));
        // What the route answers: the ids it actually considered, and which of those are running.
        const asked = new URL(url, "https://spec.invalid").searchParams.get("ids")?.split(",") ?? [];
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ asked: consider === null ? asked : consider, live: served }) });
      }),
    );
  });

  afterEach(() => vi.useRealTimers());

  it("gives each collection its own chats, and nothing to the others", () => {
    holdCollectionChat(works, request("a"));
    expect(ids(works)).toEqual(["a"]);
    expect(ids(todos)).toEqual([]);
    expect(collectionChatsFor(todos).activeId).toBeNull();
  });

  // The session outlives the pane: that is what makes "go to the grid and come back" work.
  it("keeps what it was given until it is dropped", () => {
    holdCollectionChat(works, request("a"));
    dropCollectionChat(works, "a");
    expect(ids(works)).toEqual([]);
  });

  // A second question while the first is still working is the ordinary case. The earlier version
  // paid for it by pushing the first one to the grid; now they are tabs.
  it("keeps them all, newest shown", () => {
    holdCollectionChat(works, request("first"));
    holdCollectionChat(works, request("second"));
    expect(ids(works)).toEqual(["first", "second"]);
    expect(collectionChatsFor(works).activeId).toBe("second");
  });

  it("shows the one asked for, and ignores an id it does not hold", () => {
    holdCollectionChat(works, request("first"));
    holdCollectionChat(works, request("second"));
    activateCollectionChat(works, "first");
    expect(collectionChatsFor(works).activeId).toBe("first");
    activateCollectionChat(works, "gone");
    expect(collectionChatsFor(works).activeId).toBe("first"); // not left pointing at nothing
  });

  it("files the same session once, however often it arrives", () => {
    holdCollectionChat(works, request("a"));
    holdCollectionChat(works, request("a"));
    expect(ids(works)).toEqual(["a"]);
  });

  // Closing the tab you are looking at lands you on the one to its LEFT — the one you were looking
  // at before it — rather than on whichever happens to be first.
  it("moves to the left neighbour when the shown one goes", () => {
    ["a", "b", "c"].forEach((id) => holdCollectionChat(works, request(id)));
    activateCollectionChat(works, "c");
    dropCollectionChat(works, "c");
    expect(collectionChatsFor(works).activeId).toBe("b");
    dropCollectionChat(works, "a"); // ...and dropping one you are NOT looking at leaves you put
    expect(collectionChatsFor(works).activeId).toBe("b");
  });

  it("falls back to the first when the shown one was leftmost", () => {
    ["a", "b"].forEach((id) => holdCollectionChat(works, request(id)));
    activateCollectionChat(works, "a");
    dropCollectionChat(works, "a");
    expect(collectionChatsFor(works).activeId).toBe("b");
  });

  it("answers empty for a view that cannot hold any", () => {
    expect(collectionChatsFor(null).sessions).toEqual([]);
  });

  // A session that ends while its terminal is not mounted never fires an `exit` for anyone to hear
  // (Codex, PR #2002). The server says so on its own channel, once, for every consumer.
  it("forgets a chat the server says has closed, wherever it is filed", () => {
    holdCollectionChat(works, request("a"));
    holdCollectionChat(todos, request("a")); // the same session cannot really be in two, but the
    holdCollectionChat(todos, request("b")); // sweep must not depend on knowing where it was
    bus.push({ id: "a", event: "closed" });
    expect(ids(works)).toEqual([]);
    expect(ids(todos)).toEqual(["b"]);
    expect(collectionChatCount()).toBe(1); // and nothing else moved
  });

  it("leaves everything alone for a session it does not hold, and for an ordinary update", () => {
    holdCollectionChat(works, request("a"));
    bus.push({ id: "somebody-else", event: "closed" });
    bus.push({ id: "a", working: true }); // still going — not an ending
    expect(ids(works)).toEqual(["a"]);
  });

  // One listener, opened when there is something to listen for. Filing more chats must not stack up
  // callbacks on a socket every other composable shares.
  it("listens once, however many chats are filed", () => {
    holdCollectionChat(works, request("a"));
    holdCollectionChat(works, request("b"));
    holdCollectionChat(todos, request("c"));
    expect(bus.subscribed).toBe(1);
  });

  it("takes an ended session out of the door's count", () => {
    holdCollectionChat(works, request("a"));
    holdCollectionChat(todos, request("b"));
    forgetEndedChat("a");
    expect(collectionChatCount()).toBe(1);
  });

  // Pub/sub replays room membership on reconnect, not the events missed while it was down — so an
  // ending that happened in that window is never pushed (Codex, PR #2002). The reconnect asks.
  it("retires what the server no longer runs, after the socket comes back", async () => {
    holdCollectionChat(works, request("a"));
    holdCollectionChat(todos, request("gone"));
    served = ["a", "gone"]; // both alive while the settle check passes over them
    await settle();
    expect(ids(todos)).toEqual(["gone"]); // ...so nothing has retired it yet
    served = ["a"]; // it ends while the socket is down
    bus.connect();
    await flush();
    expect(ids(works)).toEqual(["a"]);
    expect(ids(todos)).toEqual([]); // and only the reconnect could have found that out
    expect(collectionChatCount()).toBe(1);
  });

  // These are running agents. "We could not check" is not "it ended", and closing a live chat's
  // tab is worse than leaving a stale one.
  it("leaves every tab standing when the check fails or makes no sense", async () => {
    holdCollectionChat(works, request("a"));
    served = null; // the request throws
    await settle();
    bus.connect();
    await flush();
    expect(ids(works)).toEqual(["a"]);
    served = "not a list";
    bus.connect();
    await flush();
    expect(ids(works)).toEqual(["a"]);
    consider = "not a list either";
    served = [];
    bus.connect();
    await flush();
    expect(ids(works)).toEqual(["a"]);
  });

  it("asks about every collection's chats at once, and asks nothing when there are none", async () => {
    holdCollectionChat(works, request("a"));
    holdCollectionChat(todos, request("b"));
    served = ["a", "b"];
    await settle();
    vi.mocked(fetch).mockClear();
    bus.connect();
    await flush();
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("ids=a%2Cb");
    resetCollectionChats();
    vi.mocked(fetch).mockClear();
    bus.connect();
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  // The route validates and caps the ids it was given, so what it answers about is not what we
  // sent. Retiring on "not in live" would close a live chat we merely failed to ask about.
  it("retires only among the ids the answer considered", async () => {
    holdCollectionChat(works, request("asked-about"));
    holdCollectionChat(works, request("over-the-cap"));
    consider = ["asked-about"]; // the route dropped the rest
    served = [];
    await settle();
    bus.connect();
    await flush();
    expect(ids(works)).toEqual(["over-the-cap"]);
    expect(ids(works)).not.toContain("asked-about");
  });

  // Subscribing does not close the window on its own: on an already-connected socket the room join
  // is emitted and the server can publish `closed` before it processes it, so nothing would ask
  // again until a connect that may never come (Codex, PR #2002).
  it("checks by itself once a new chat has settled, with no connect at all", async () => {
    holdCollectionChat(works, request("died-instantly"));
    served = [];
    await flush();
    expect(ids(works)).toEqual(["died-instantly"]); // ...but not before it could have registered
    expect(fetch).not.toHaveBeenCalled();
    await settle();
    expect(ids(works)).toEqual([]);
  });

  // The other half of that grace: the spawn route answers before the session is registered, so a
  // chat filed a moment ago is legitimately absent from the live list.
  it("never retires a chat that was just started", async () => {
    holdCollectionChat(works, request("just-started"));
    served = [];
    bus.connect();
    await flush();
    expect(ids(works)).toEqual(["just-started"]);
    expect(fetch).not.toHaveBeenCalled(); // there was nothing it was allowed to ask about
  });

  // The listener costs a callback on every session row the app publishes. Nothing filed, nothing to
  // keep honest (Codex, PR #2002).
  it("stops listening when the last chat goes, and listens again for the next one", () => {
    holdCollectionChat(works, request("a"));
    holdCollectionChat(todos, request("b"));
    expect(bus.listening).toBe(1);
    dropCollectionChat(works, "a");
    expect(bus.listening).toBe(1); // one collection still holds a chat
    dropCollectionChat(todos, "b");
    expect(bus.listening).toBe(0);
    holdCollectionChat(works, request("c"));
    expect(bus.listening).toBe(1);
    expect(bus.subscribed).toBe(2);
  });

  // The route considers only the first 200 ids it is given, so one request for everything leaves
  // the rest unasked for as long as the filing stands (Codex, PR #2002).
  it("asks about every filed chat, in batches the route will actually consider", async () => {
    const many = Array.from({ length: 250 }, (_, i) => `s${i}`);
    many.forEach((id) => holdCollectionChat(works, request(id)));
    served = many; // all of them running while the grace passes
    await settle();
    served = many.filter((id) => id !== "s240"); // ...then one ends while the socket is down
    vi.mocked(fetch).mockClear();
    bus.connect();
    await flush();
    const asked = vi.mocked(fetch).mock.calls.flatMap((call) => new URL(String(call[0]), "https://spec.invalid").searchParams.get("ids")?.split(",") ?? []);
    expect(asked).toHaveLength(250);
    expect(asked).toContain("s240");
    expect(ids(works)).toHaveLength(249);
    expect(ids(works)).not.toContain("s240");
  });
});
