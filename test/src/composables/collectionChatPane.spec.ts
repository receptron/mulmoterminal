// @vitest-environment node
// Who places a chat started from a collection (#2001).
//
// The claim sits IN FRONT of the grid's own seam rather than replacing it: `useSpawnedChat` holds a
// single handler, so registering there would detach GridView's and leave it detached (the grid
// registers on activate, not on every navigation). With nothing claimed, every path behaves exactly
// as it did before this existed — which is what the first case pins.
import { describe, it, expect } from "vitest";
import { claimCollectionChat, offerCollectionChat } from "../../../src/composables/collectionChatPane";
import type { SpawnedChatRequest } from "../../../src/composables/useSpawnedChat";

const request = (id: string): SpawnedChatRequest => ({ id, agent: "claude", draft: false });

describe("collection chat placement", () => {
  it("refuses when no pane is open, so the grid path runs unchanged", () => {
    expect(offerCollectionChat(request("a"))).toBe(false);
  });

  it("hands the session to the pane that claimed it", () => {
    const seen: string[] = [];
    const release = claimCollectionChat((req) => {
      seen.push(req.id);
      return true;
    });
    expect(offerCollectionChat(request("a"))).toBe(true);
    expect(seen).toEqual(["a"]);
    release();
  });

  it("goes back to the grid path once the pane releases", () => {
    const release = claimCollectionChat(() => true);
    release();
    expect(offerCollectionChat(request("a"))).toBe(false);
  });

  // A stale release must not detach a newer claim — the overlay can be re-opened before the old
  // component's teardown runs, and the second pane would then silently stop receiving chats.
  it("ignores a release from a claim that has already been replaced", () => {
    const staleRelease = claimCollectionChat(() => true);
    const seen: string[] = [];
    claimCollectionChat((req) => {
      seen.push(req.id);
      return true;
    });
    staleRelease();
    expect(offerCollectionChat(request("b"))).toBe(true);
    expect(seen).toEqual(["b"]);
  });

  // A pane that cannot take it (nothing to show it in) must not swallow the session: false here
  // is what sends it to the grid instead of leaving a live agent on no screen at all.
  it("falls through to the grid when the claim declines", () => {
    const release = claimCollectionChat(() => false);
    expect(offerCollectionChat(request("a"))).toBe(false);
    release();
  });
});
