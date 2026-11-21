import { describe, it, expect } from "vitest";
import { mainlineGroups } from "../../../src/components/boardMainline";
import type { BoardMainlineCell } from "../../../common/githubBoard";

const at = (session: string, branch: string | null): BoardMainlineCell => ({ session, cwd: `/w/${session}`, working: false, waiting: false, branch });

describe("mainlineGroups", () => {
  it("groups by branch in the order first seen, with the cells on no branch last", () => {
    const groups = mainlineGroups([at("a", null), at("b", "main"), at("c", "master"), at("d", "main"), at("e", null)]);
    expect(groups.map((group) => [group.branch, group.cells.map((cell) => cell.session)])).toEqual([
      ["main", ["b", "d"]],
      ["master", ["c"]],
      [null, ["a", "e"]],
    ]);
  });

  it("is empty for no cells", () => {
    expect(mainlineGroups([])).toEqual([]);
  });
});
