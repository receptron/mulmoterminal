// The cells on a repo's default branch or on no branch (#3376), grouped for the row above the columns.
import type { BoardMainlineCell } from "../../common/githubBoard";

export interface MainlineGroup {
  /** The default branch's name, or null for the cells on no branch. */
  branch: string | null;
  cells: BoardMainlineCell[];
}

/** One group per branch in the order first seen, the cells on no branch last. */
export const mainlineGroups = (cells: readonly BoardMainlineCell[]): MainlineGroup[] => {
  const byBranch = new Map<string | null, BoardMainlineCell[]>();
  cells.forEach((cell) => byBranch.set(cell.branch, [...(byBranch.get(cell.branch) ?? []), cell]));
  const groups = [...byBranch.entries()].map(([branch, grouped]) => ({ branch, cells: grouped }));
  return [...groups.filter((group) => group.branch !== null), ...groups.filter((group) => group.branch === null)];
};
