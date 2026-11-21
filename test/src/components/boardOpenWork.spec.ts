import { describe, it, expect } from "vitest";
import { openWorkOnly, registeredOnly, visibleColumns } from "../../../src/components/boardOpenWork";
import { BOARD_COLUMNS, type BoardCard, type BoardColumn, type RepoBoard } from "../../../common/githubBoard";

const cell = { session: "s", cwd: "/w", working: false, waiting: false };
const card = (key: string, column: BoardColumn, open: boolean): BoardCard => ({ key, column, issue: null, pr: null, branch: null, cells: open ? [cell] : [] });

describe("openWorkOnly", () => {
  it("keeps only the cards carrying a cell, in their order", () => {
    const repos: RepoBoard[] = [{ repo: "o/r", cards: [card("a", "todo", false), card("b", "review", true), card("c", "merged", true)] }];
    expect(openWorkOnly(repos)[0].cards?.map((c) => c.key)).toEqual(["b", "c"]);
  });

  it("drops a repo left with no card, and one that had none", () => {
    expect(openWorkOnly([{ repo: "o/idle", cards: [card("a", "todo", false)] }, { repo: "o/empty", cards: [] }, { repo: "o/none" }])).toEqual([]);
  });

  it("keeps a repo whose only open terminal is on its default branch", () => {
    const repos: RepoBoard[] = [{ repo: "o/main-only", cards: [card("a", "todo", false)], mainlineCells: [{ ...cell, branch: "main" }] }];
    expect(openWorkOnly(repos)).toEqual([{ repo: "o/main-only", cards: [], mainlineCells: [{ ...cell, branch: "main" }] }]);
  });

  it("keeps a repo carrying an error as it is", () => {
    const broken: RepoBoard = { repo: "o/broken", error: "gh failed" };
    expect(openWorkOnly([broken])).toEqual([broken]);
  });

  it("does not change the board it was handed", () => {
    const repos: RepoBoard[] = [{ repo: "o/r", cards: [card("a", "todo", false), card("b", "qa", true)] }];
    const before = structuredClone(repos);
    openWorkOnly(repos);
    expect(repos).toEqual(before);
  });

  it("answers an empty board with an empty one", () => {
    expect(openWorkOnly([])).toEqual([]);
  });
});

describe("registeredOnly", () => {
  it("drops the repos read only because a terminal is open in them, keeping the order", () => {
    const repos: RepoBoard[] = [{ repo: "o/a" }, { repo: "x/y", unregistered: true, cards: [card("a", "qa", true)] }, { repo: "o/b", unregistered: false }];
    expect(registeredOnly(repos).map((repo) => repo.repo)).toEqual(["o/a", "o/b"]);
  });

  it("answers an empty board with an empty one", () => {
    expect(registeredOnly([])).toEqual([]);
  });
});

describe("visibleColumns", () => {
  const repo: RepoBoard = { repo: "o/r", cards: [card("a", "merged", true), card("b", "implementing", true)] };

  it("is every column with the switch off, cards or not", () => {
    expect(visibleColumns(repo, false)).toEqual(BOARD_COLUMNS);
    expect(visibleColumns({ repo: "o/none" }, false)).toEqual(BOARD_COLUMNS);
  });

  it("is the columns holding a card with the switch on, in board order", () => {
    expect(visibleColumns(repo, true)).toEqual(["implementing", "merged"]);
  });

  it("is no column for a repo without cards", () => {
    expect(visibleColumns({ repo: "o/none" }, true)).toEqual([]);
  });
});
