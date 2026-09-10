// @vitest-environment node
// Which sessions are still running (#2001). Asked by the collection pane after a dropped pub/sub
// connection, where the `closed` push that retires a chat's tab was never delivered.
import { describe, it, expect } from "vitest";
import { liveSessionAnswer, liveSessionIds } from "../../../server/session/live-sessions";

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

// What the route actually answers. `asked` is the contract that lets a caller retire safely: it
// retires only within it, so "I could not check" is said by considering nothing.
describe("liveSessionAnswer", () => {
  const hasPty = (id: string) => id === "running";

  it("reports what it asked about and which of those are live", () => {
    expect(liveSessionAnswer(["running", "gone"], hasPty, [])).toEqual({ asked: ["running", "gone"], live: ["running"] });
  });

  it("counts a session tmux is holding as live", () => {
    expect(liveSessionAnswer(["detached"], hasPty, ["detached"])).toEqual({ asked: ["detached"], live: ["detached"] });
  });

  // The failure this shape exists to prevent: an unreadable tmux must not read as "every persisted
  // session has ended" (CodeRabbit, PR #2002). Considering nothing retires nothing.
  it("considers nothing when tmux could not be asked", () => {
    expect(liveSessionAnswer(["detached", "running"], hasPty, null)).toEqual({ asked: [], live: [] });
  });

  it("considers nothing when the request named nothing usable", () => {
    expect(liveSessionAnswer([], hasPty, [])).toEqual({ asked: [], live: [] });
  });
});
