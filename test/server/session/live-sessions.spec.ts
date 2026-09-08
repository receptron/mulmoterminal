// @vitest-environment node
// Which sessions are still running (#2001). Asked by the collection pane after a dropped pub/sub
// connection, where the `closed` push that retires a chat's tab was never delivered.
import { describe, it, expect } from "vitest";
import { liveSessionIds } from "../../../server/session/live-sessions";

const noPty = (): boolean => false;

describe("liveSessionIds", () => {
  it("keeps a session with a live pty, and one tmux is holding", () => {
    expect(liveSessionIds(["a", "b"], (id) => id === "a", ["b"])).toEqual(["a", "b"]);
  });

  it("drops one that is neither", () => {
    expect(liveSessionIds(["a", "gone"], (id) => id === "a", [])).toEqual(["a"]);
  });

  // Both limbs are asked for every id: a session detached from this process is still running under
  // tmux, and one this process spawned on a tmux-less host is running with no tmux to list it.
  it("needs only one of the two", () => {
    expect(liveSessionIds(["a"], noPty, ["a"])).toEqual(["a"]);
    expect(liveSessionIds(["a"], (id) => id === "a", [])).toEqual(["a"]);
  });

  it("answers in the order asked, and says nothing about ids nobody asked about", () => {
    expect(liveSessionIds(["c", "a"], noPty, ["a", "b", "c"])).toEqual(["c", "a"]);
    expect(liveSessionIds([], noPty, ["a"])).toEqual([]);
  });
});
