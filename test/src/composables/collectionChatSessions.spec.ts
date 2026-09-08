// @vitest-environment node
// What a chat started from a collection is filed under (#2001).
//
// The key is the whole design: the first version filed nothing and tied the session to the OVERLAY,
// which is why the pane stayed open after switching collections and why going to the grid and back
// left nothing to return to.
import { describe, it, expect, beforeEach, vi } from "vitest";

// The filing keeps itself honest off the server's own session channel, and tears a terminal slot
// down when it does. Both are played by hand here.
const silence = (): void => {};
const bus = vi.hoisted((): { push: (data: unknown) => void; subscribed: number; released: string[] } => ({
  push: () => {},
  subscribed: 0,
  released: [],
}));
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (_channel: string, callback: (data: unknown) => void) => {
      bus.push = callback;
      bus.subscribed += 1;
      return silence;
    },
  }),
}));
vi.mock("../../../src/composables/useTerminalConnections", () => ({ release: (key: string) => bus.released.push(key) }));

import {
  collectionChatSlotKey,
  forgetEndedChat,
  activateCollectionChat,
  collectionChatKey,
  collectionChatCount,
  collectionChatsFor,
  dropCollectionChat,
  holdCollectionChat,
  resetCollectionChats,
} from "../../../src/composables/collectionChatSessions";
import type { SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";

const request = (id: string): SpawnedChatRequest => ({ id, agent: "claude", draft: false });

describe("collectionChatKey", () => {
  it("files a collection and a feed of the same slug apart", () => {
    const collection = collectionChatKey({ mode: "detail", kind: "collection", slug: "news" }, null);
    const feed = collectionChatKey({ mode: "detail", kind: "feed", slug: "news" }, null);
    expect(collection).not.toBe(feed);
  });

  // The same slug in two projects is two collections — the distinction the whole collectionSurface
  // stack exists to keep.
  it("files the same slug in two projects apart", () => {
    const workspace = collectionChatKey({ mode: "detail", kind: "collection", slug: "works" }, null);
    const project = collectionChatKey({ mode: "detail", kind: "collection", slug: "works" }, "proj-1");
    expect(workspace).not.toBe(project);
  });

  // The index is a place too: the "+ Collection" flow starts its chat there, before any collection
  // exists to belong to.
  it("gives the index its own key, apart from any collection", () => {
    const index = collectionChatKey({ mode: "index", kind: "collection" }, null);
    expect(index).not.toBeNull();
    expect(index).not.toBe(collectionChatKey({ mode: "detail", kind: "collection", slug: "index" }, null));
  });

  it("answers null when nothing is open to file under", () => {
    expect(collectionChatKey({ mode: "closed" }, null)).toBeNull();
  });
});

describe("filing a collection's chats", () => {
  const works = collectionChatKey({ mode: "detail", kind: "collection", slug: "works" }, null) ?? "";
  const todos = collectionChatKey({ mode: "detail", kind: "collection", slug: "todos" }, null) ?? "";
  const ids = (key: string): string[] => collectionChatsFor(key).sessions.map((session) => session.id);

  beforeEach(() => {
    resetCollectionChats();
    bus.subscribed = 0;
    bus.released = [];
  });

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
    expect(bus.released).toEqual([collectionChatSlotKey("a")]); // and its terminal goes with it
  });

  it("leaves everything alone for a session it does not hold, and for an ordinary update", () => {
    holdCollectionChat(works, request("a"));
    bus.push({ id: "somebody-else", event: "closed" });
    bus.push({ id: "a", working: true }); // still going — not an ending
    expect(ids(works)).toEqual(["a"]);
    expect(bus.released).toEqual([]);
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
});
