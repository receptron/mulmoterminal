import { describe, it, expect } from "vitest";
import { boardSessionIds, cardWaiting, closesAfter, finishedTurns, withLiveCells, withoutClosedCells } from "../../../src/components/boardLive";
import type { BoardCard, BoardCell, RepoBoard } from "../../../common/githubBoard";

const cell = (session: string, over: Partial<BoardCell> = {}): BoardCell => ({ session, cwd: `/w/${session}`, working: false, waiting: false, ...over });
const card = (key: string, cells: BoardCell[]): BoardCard => ({ key, column: "implementing", issue: null, pr: null, branch: key, cells });
const live = (working: boolean, waiting: boolean) => ({ working, waiting, event: null });

describe("boardSessionIds", () => {
  it("lists every cell's session once, across cards and repos", () => {
    const repos: RepoBoard[] = [
      { repo: "o/a", cards: [card("x", [cell("s1"), cell("s2")]), card("y", [cell("s1")])] },
      { repo: "o/b", cards: [card("z", [cell("s3")])] },
      { repo: "o/c", error: "nope" },
    ];
    expect(boardSessionIds(repos)).toEqual(["s1", "s2", "s3"]);
  });

  it("is empty for a board with no cells", () => {
    expect(boardSessionIds([])).toEqual([]);
    expect(boardSessionIds([{ repo: "o/a", cards: [card("x", [])] }])).toEqual([]);
  });
});

describe("withLiveCells", () => {
  const repos: RepoBoard[] = [
    { repo: "o/a", cards: [card("x", [cell("s1", { working: true }), cell("s2", { waiting: true })])] },
    { repo: "o/c", error: "nope" },
  ];

  it("takes each cell's state from the feed where the feed has it", () => {
    const out = withLiveCells(repos, new Map([["s1", live(false, true)]]));
    expect(out[0]?.cards?.[0]?.cells).toEqual([cell("s1", { working: false, waiting: true }), cell("s2", { waiting: true })]);
  });

  it("leaves the loaded board untouched, and passes an errored repo through", () => {
    const out = withLiveCells(repos, new Map([["s1", live(false, false)]]));
    expect(repos[0]?.cards?.[0]?.cells[0]?.working).toBe(true);
    expect(out[1]).toEqual({ repo: "o/c", error: "nope" });
  });
});

describe("cardWaiting", () => {
  it("is true when any cell waits, false otherwise", () => {
    expect(cardWaiting(card("x", [cell("s1"), cell("s2", { waiting: true })]))).toBe(true);
    expect(cardWaiting(card("x", [cell("s1", { working: true })]))).toBe(false);
    expect(cardWaiting(card("x", []))).toBe(false);
  });
});

describe("finishedTurns", () => {
  const map = (entries: [string, boolean][]) => new Map(entries);

  it("names a session that went from working to idle, or closed while working", () => {
    expect(
      finishedTurns(
        map([
          ["s1", true],
          ["s2", true],
        ]),
        map([["s1", false]]),
      ),
    ).toEqual(["s1", "s2"]);
  });

  it("names nothing for a session that starts, stays working, or stays idle", () => {
    expect(
      finishedTurns(
        map([
          ["s1", false],
          ["s2", true],
        ]),
        map([
          ["s1", true],
          ["s2", true],
          ["s3", true],
        ]),
      ),
    ).toEqual([]);
    expect(finishedTurns(map([["s1", false]]), map([]))).toEqual([]);
    expect(finishedTurns(map([]), map([["s1", false]]))).toEqual([]);
  });
});

describe("withoutClosedCells", () => {
  const repos: RepoBoard[] = [
    { repo: "o/a", cards: [card("x", [cell("s1"), cell("s2")]), card("y", [cell("s1")])] },
    { repo: "o/err", error: "gh failed" },
  ];

  it("drops a closed session's cell from every card that carries it, keeping the rest", () => {
    const out = withoutClosedCells(repos, new Map([["s1", 1]]));
    expect(out[0].cards?.map((c) => c.cells.map((x) => x.session))).toEqual([["s2"], []]);
    expect(out[1]).toEqual(repos[1]);
  });

  it("keeps the card itself when its last cell closes, for the switch to decide", () => {
    expect(withoutClosedCells(repos, new Map([["s1", 1]]))[0].cards?.map((c) => c.key)).toEqual(["x", "y"]);
  });

  it("changes nothing with no closes, or closes of sessions on no card", () => {
    expect(withoutClosedCells(repos, new Map())).toEqual(repos);
    expect(withoutClosedCells(repos, new Map([["gone", 3]]))).toEqual(repos);
  });

  it("does not change the board it was handed", () => {
    const before = structuredClone(repos);
    withoutClosedCells(
      repos,
      new Map([
        ["s1", 1],
        ["s2", 2],
      ]),
    );
    expect(repos).toEqual(before);
  });

  it("answers an empty board with an empty one", () => {
    expect(withoutClosedCells([], new Map([["s1", 1]]))).toEqual([]);
  });
});

describe("closesAfter", () => {
  const closed = new Map([
    ["early", 1],
    ["late", 5],
  ]);

  it("keeps only the closes that arrived after the read was sent", () => {
    expect([...closesAfter(closed, 3).keys()]).toEqual(["late"]);
  });

  it("keeps every close for a read sent before all of them, and none for one sent after", () => {
    expect([...closesAfter(closed, 0).keys()]).toEqual(["early", "late"]);
    expect(closesAfter(closed, 6).size).toBe(0);
  });

  it("does not change the map it was handed", () => {
    closesAfter(closed, 6);
    expect(closed.size).toBe(2);
  });

  it("answers no closes with none", () => {
    expect(closesAfter(new Map(), 1).size).toBe(0);
  });
});

describe("the cells on the default branch", () => {
  const repos: RepoBoard[] = [
    {
      repo: "o/a",
      cards: [card("x", [cell("s1")])],
      mainlineCells: [
        { ...cell("m1"), branch: "main" },
        { ...cell("m2"), branch: null },
      ],
    },
  ];

  it("are counted among the board's sessions", () => {
    expect(boardSessionIds(repos)).toEqual(["s1", "m1", "m2"]);
  });

  it("follow the live feed, keeping their branch", () => {
    expect(withLiveCells(repos, new Map([["m1", live(true, false)]]))[0]?.mainlineCells).toEqual([
      { ...cell("m1", { working: true }), branch: "main" },
      { ...cell("m2"), branch: null },
    ]);
  });

  it("leave at once when their session closes", () => {
    expect(withoutClosedCells(repos, new Map([["m2", 1]]))[0]?.mainlineCells?.map((c) => c.session)).toEqual(["m1"]);
  });

  it("leave a repo with no cell lists as the very same object", () => {
    const bare: RepoBoard[] = [{ repo: "o/err", error: "gh failed" }, { repo: "o/none" }];
    expect(withLiveCells(bare, new Map([["s1", live(true, false)]]))[0]).toBe(bare[0]);
    expect(withoutClosedCells(bare, new Map([["s1", 1]]))[1]).toBe(bare[1]);
  });

  it("are not added to a repo that had none", () => {
    expect(withLiveCells([{ repo: "o/b", cards: [] }], new Map())[0]).not.toHaveProperty("mainlineCells");
    expect(withoutClosedCells([{ repo: "o/b", cards: [] }], new Map([["x", 1]]))[0]).not.toHaveProperty("mainlineCells");
  });
});
