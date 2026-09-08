// @vitest-environment node
// What a chat started from a collection is filed under (#2001).
//
// The key is the whole design: the first version filed nothing and tied the session to the OVERLAY,
// which is why the pane stayed open after switching collections and why going to the grid and back
// left nothing to return to.
import { describe, it, expect, beforeEach } from "vitest";
import {
  collectionChatKey,
  collectionChatFor,
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

describe("filing a session", () => {
  beforeEach(resetCollectionChats);

  it("gives each collection its own session, and nothing to the others", () => {
    const works = collectionChatKey({ mode: "detail", kind: "collection", slug: "works" }, null) ?? "";
    const todos = collectionChatKey({ mode: "detail", kind: "collection", slug: "todos" }, null) ?? "";
    holdCollectionChat(works, request("a"));
    expect(collectionChatFor(works)?.id).toBe("a");
    expect(collectionChatFor(todos)).toBeNull();
  });

  // The session outlives the pane: that is what makes "go to the grid and come back" work.
  it("keeps what it was given until it is dropped", () => {
    const works = collectionChatKey({ mode: "detail", kind: "collection", slug: "works" }, null) ?? "";
    holdCollectionChat(works, request("a"));
    expect(collectionChatFor(works)?.id).toBe("a");
    dropCollectionChat(works);
    expect(collectionChatFor(works)).toBeNull();
  });

  // The caller has to put the replaced one somewhere — it is a running agent, and answering it here
  // is what stops it being dropped silently.
  it("answers what a second chat in the same collection displaced", () => {
    const works = collectionChatKey({ mode: "detail", kind: "collection", slug: "works" }, null) ?? "";
    expect(holdCollectionChat(works, request("first"))).toBeNull();
    expect(holdCollectionChat(works, request("second"))?.id).toBe("first");
    expect(collectionChatFor(works)?.id).toBe("second");
  });

  it("answers null for a view that cannot hold one", () => {
    expect(collectionChatFor(null)).toBeNull();
  });
});
