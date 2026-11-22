import { describe, it, expect } from "vitest";
import { isWithin, relayPartners } from "../../../src/composables/relayPartners";
import type { SlotInfo } from "../../../src/composables/readableSlot";

const slot = (key: string, cwd: string | null): SlotInfo => ({ key, sessionId: `sess-${key}`, agent: "claude", cwd });
const keys = (slots: SlotInfo[]): string[] => slots.map((s) => s.key);

describe("isWithin", () => {
  it.each([
    ["/r", "/r", true],
    ["/r/", "/r", true],
    ["/r", "/r/", true],
    ["/r/sub/deep", "/r", true],
    ["/rx", "/r", false],
    ["/r-wt/a", "/r", false],
    ["/", "/", true],
    ["C:\\r\\sub", "C:\\r", true],
    ["C:\\rx", "C:\\r", false],
    ["", "/r", false],
  ])("%s within %s → %s", (dir, root, expected) => expect(isWithin(dir, root)).toBe(expected));
});

describe("relayPartners", () => {
  const worktrees = ["/repo", "/repo/.worktrees/feat-x", "/elsewhere/repo-fix"];

  it("pairs a terminal in the same directory", () => {
    expect(keys(relayPartners([slot("cell-1", "/repo"), slot("cell-2", "/repo")], "cell-1", "/repo", []))).toEqual(["cell-2"]);
  });

  it("pairs terminals in any worktree of the repo, wherever it lives, and in their subdirectories", () => {
    const slots = [slot("cell-1", "/repo"), slot("cell-2", "/repo/.worktrees/feat-x"), slot("cell-3", "/elsewhere/repo-fix/src"), slot("cell-4", "/other")];
    expect(keys(relayPartners(slots, "cell-1", "/repo", worktrees))).toEqual(["cell-2", "cell-3"]);
  });

  it("works the same from inside a worktree", () => {
    const slots = [slot("cell-1", "/repo/.worktrees/feat-x"), slot("cell-2", "/repo")];
    expect(keys(relayPartners(slots, "cell-1", "/repo/.worktrees/feat-x", worktrees))).toEqual(["cell-2"]);
  });

  it("outside git only the same directory counts", () => {
    const slots = [slot("cell-1", "/tmp/a"), slot("cell-2", "/tmp/a/"), slot("cell-3", "/tmp/a/sub"), slot("cell-4", "/tmp/b")];
    expect(keys(relayPartners(slots, "cell-1", "/tmp/a", []))).toEqual(["cell-2"]);
  });

  it("never pairs a cell with itself, nor a terminal whose directory is unknown", () => {
    expect(relayPartners([slot("cell-1", "/repo"), slot("cell-2", null)], "cell-1", "/repo", worktrees)).toEqual([]);
  });

  it("finds nothing for a cell with no directory, or with no other terminal", () => {
    expect(relayPartners([slot("cell-1", "/repo"), slot("cell-2", "/repo")], "cell-1", null, worktrees)).toEqual([]);
    expect(relayPartners([], "cell-1", "/repo", worktrees)).toEqual([]);
  });
});
