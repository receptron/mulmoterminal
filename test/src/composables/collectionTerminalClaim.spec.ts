// @vitest-environment node
// Which session's cell the collection pane is showing, and where (#2001).
import { describe, it, expect, beforeEach } from "vitest";
import {
  claimCollectionTerminal,
  collectionTerminalClaim,
  gridSessionIds,
  publishGridSessions,
  releaseCollectionTerminal,
} from "../../../src/composables/collectionTerminalClaim";

// A stand-in for the pane's receptacle: the claim carries a DOM node, and what these cases are
// about is which node is carried, not what is in it.
const el = (name: string) => ({ name }) as unknown as HTMLElement;

describe("the collection terminal claim", () => {
  beforeEach(() => releaseCollectionTerminal(collectionTerminalClaim.value?.sessionId ?? ""));

  it("starts with nothing claimed", () => {
    expect(collectionTerminalClaim.value).toBeNull();
  });

  it("names the session and where it goes", () => {
    const target = el("pane");
    claimCollectionTerminal("a", target);
    expect(collectionTerminalClaim.value).toEqual({ sessionId: "a", el: target });
  });

  // The pane shows one terminal at a time; switching tabs is what moves the claim.
  it("replaces the previous claim rather than adding to it", () => {
    claimCollectionTerminal("a", el("pane"));
    claimCollectionTerminal("b", el("pane"));
    expect(collectionTerminalClaim.value?.sessionId).toBe("b");
  });

  it("gives the cell back to the grid on release", () => {
    claimCollectionTerminal("a", el("pane"));
    releaseCollectionTerminal("a");
    expect(collectionTerminalClaim.value).toBeNull();
  });

  // A pane can be replaced before the old one's teardown runs — the overlay reopening, a hot
  // reload — and the stale release must not strand the new claim.
  it("ignores a release from a session it is no longer showing", () => {
    claimCollectionTerminal("a", el("first"));
    claimCollectionTerminal("b", el("second"));
    releaseCollectionTerminal("a");
    expect(collectionTerminalClaim.value?.sessionId).toBe("b");
  });
});

// The grid's half of the same conversation.
describe("what the grid says it holds", () => {
  // Null, not empty: "the grid has not answered" is what stops a restored filing being retired
  // before the layout has been read, and an assertion that accepts [] would not notice the
  // difference (CodeRabbit, PR #2002). Runs before the publish below, which is what sets it.
  it("says nothing until the grid has answered", () => {
    expect(gridSessionIds.value).toBeNull();
  });

  it("reports the sessions it was given, including none", () => {
    publishGridSessions(["a", "b"]);
    expect(gridSessionIds.value).toEqual(["a", "b"]);
    publishGridSessions([]);
    expect(gridSessionIds.value).toEqual([]); // an EMPTY answer, which is not the same as no answer
  });
});
