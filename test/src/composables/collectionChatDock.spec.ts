// Where the chat sits relative to the collection (#2001) — under it or beside it.
import { describe, it, expect, beforeEach } from "vitest";
import { parseChatDock, collectionChatDock, toggleCollectionChatDock } from "../../../src/composables/collectionChatDock";

describe("parseChatDock", () => {
  it("reads the alternative, and nothing else", () => {
    expect(parseChatDock("right")).toBe("right");
    expect(parseChatDock("bottom")).toBe("bottom");
  });

  // Storage is a string anyone can write — a hand-edited key, or one a later version wrote. A value
  // neither layout describes would size the pane along an axis it is not docked on.
  it("falls back to the default for anything it does not describe", () => {
    expect(parseChatDock(null)).toBe("bottom");
    expect(parseChatDock("")).toBe("bottom");
    expect(parseChatDock("RIGHT")).toBe("bottom");
    expect(parseChatDock("left")).toBe("bottom");
  });
});

describe("toggleCollectionChatDock", () => {
  beforeEach(() => {
    collectionChatDock.value = "bottom";
  });

  it("moves between the two docks and remembers where it stopped", async () => {
    toggleCollectionChatDock();
    expect(collectionChatDock.value).toBe("right");
    // The watch that persists it is Vue's, so it lands on the next tick rather than in the call.
    await Promise.resolve();
    expect(localStorage.getItem("mt-collection-chat-dock")).toBe("right");

    toggleCollectionChatDock();
    expect(collectionChatDock.value).toBe("bottom");
    await Promise.resolve();
    expect(localStorage.getItem("mt-collection-chat-dock")).toBe("bottom");
  });
});
