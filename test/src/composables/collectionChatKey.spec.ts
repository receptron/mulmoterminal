// @vitest-environment node
// What a chat started from a collection is filed under (#2001).
//
// The key is the whole design: the first version filed nothing and tied the session to the OVERLAY,
// which is why the pane stayed open after switching collections and why going to the grid and back
// left nothing to return to.
import { describe, it, expect } from "vitest";
import { collectionChatKey } from "../../../src/composables/collectionChatKey";

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
