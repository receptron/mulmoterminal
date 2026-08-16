import { describe, it, expect } from "vitest";
import { RIGHT_PANES, isRightPane } from "../../../src/components/gridCell";

// A pane read back from localStorage passes through `isRightPane` (TerminalGrid's
// `readPaneBySession`), and while that guard was its own hand-written list, a new pane could be
// wired end to end and still never reopen after a reload — silently, since an unrecognised value
// is simply dropped. `prompts` shipped that way and CodeRabbit caught it (#1749).
//
// The guard now derives from RIGHT_PANES, so this asserts the derivation rather than a copy of
// the list: a member added to the union is covered the day it is added.
describe("isRightPane", () => {
  it("accepts every pane the grid can open", () => {
    expect(RIGHT_PANES.length).toBeGreaterThan(5); // guards against an empty list passing vacuously
    RIGHT_PANES.forEach((pane) => expect(isRightPane(pane)).toBe(true));
  });

  it("rejects anything else a stored value could be", () => {
    [undefined, null, "", "Files", "prompt", 0, [], {}, "toggle-prompts"].forEach((value) => expect(isRightPane(value)).toBe(false));
  });
});
