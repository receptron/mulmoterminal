// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildRepoBoard, mainlineCells, openPrColumn, parseBoardPr, type BoardPrRow, type RepoBoardInput } from "../../../server/git/board";
import type { BoardPr } from "../../../common/githubBoard";

const REPO = "o/r";

const basePr: BoardPr = {
  number: 1,
  title: "t",
  url: "https://github.com/o/r/pull/1",
  branch: "feat/x",
  isDraft: false,
  ci: "passing",
  review: null,
  reviewRounds: 0,
  headReviewed: false,
  codex: null,
};

const row = (pr: Partial<BoardPr>, closes: BoardPrRow["closes"] = []): BoardPrRow => ({ pr: { ...basePr, ...pr }, closes });

const issue = (number: number) => ({ number, title: `issue ${number}`, url: `https://github.com/o/r/issues/${number}` });

const input = (over: Partial<RepoBoardInput>): RepoBoardInput => ({
  repo: REPO,
  defaultBranch: "main",
  openPrs: [],
  mergedPrs: [],
  openIssues: [],
  cells: [],
  ...over,
});

describe("parseBoardPr", () => {
  const raw = {
    number: 7,
    title: "Add x",
    url: "https://github.com/o/r/pull/7",
    headRefName: "feat/7-x",
    headRefOid: "bbb",
    isDraft: false,
    reviewDecision: "",
    statusCheckRollup: [{ conclusion: "SUCCESS" }],
    reviews: [{ commit: { oid: "aaa" } }, { commit: { oid: "aaa" } }, { commit: { oid: "bbb" } }],
    closingIssuesReferences: [
      { number: 3, url: "https://github.com/o/r/issues/3" },
      { number: 9, url: "https://github.com/other/repo/issues/9" },
    ],
  };

  it("counts each reviewed commit once and sees whether the head was reviewed", () => {
    const parsed = parseBoardPr(raw, REPO);
    expect(parsed?.pr).toMatchObject({ number: 7, branch: "feat/7-x", ci: "passing", review: null, reviewRounds: 2, headReviewed: true });
  });

  it("keeps only the closing references in the same repo", () => {
    expect(parseBoardPr(raw, REPO)?.closes.map((ref) => ref.number)).toEqual([3]);
    expect(parseBoardPr(raw, "O/R")?.closes.map((ref) => ref.number)).toEqual([3]);
  });

  it("reads an unreviewed head and missing fields as nothing reviewed", () => {
    const parsed = parseBoardPr({ number: 2, url: "u" }, REPO);
    expect(parsed?.pr).toMatchObject({ reviewRounds: 0, headReviewed: false, ci: "none", branch: "", isDraft: false, review: null });
    expect(parsed?.closes).toEqual([]);
  });

  it("ignores malformed reviews and references", () => {
    const parsed = parseBoardPr(
      { ...raw, reviews: [null, { commit: null }, { commit: { oid: 5 } }, "x"], closingIssuesReferences: [null, { number: "3" }, "x"] },
      REPO,
    );
    expect(parsed?.pr.reviewRounds).toBe(0);
    expect(parsed?.closes).toEqual([]);
  });

  it("is null without the identity fields", () => {
    expect(parseBoardPr(null, REPO)).toBeNull();
    expect(parseBoardPr({ url: "u" }, REPO)).toBeNull();
    expect(parseBoardPr({ number: 1 }, REPO)).toBeNull();
    expect(parseBoardPr([], REPO)).toBeNull();
  });
});

describe("openPrColumn", () => {
  const column = (pr: Partial<BoardPr>) => openPrColumn({ ...basePr, ...pr });

  it("puts work that needs the author in implementing", () => {
    expect(column({ isDraft: true, headReviewed: true })).toBe("implementing");
    expect(column({ ci: "failing", headReviewed: true })).toBe("implementing");
    expect(column({ review: "CHANGES_REQUESTED", headReviewed: true })).toBe("implementing");
    expect(column({ review: "changes_requested" })).toBe("implementing");
  });

  it("is review while CI runs, even when approved", () => {
    expect(column({ ci: "pending", review: "APPROVED", headReviewed: true })).toBe("review");
  });

  it("is review until the newest commit has been reviewed", () => {
    expect(column({ headReviewed: false })).toBe("review");
    expect(column({ ci: "none", headReviewed: false, review: "REVIEW_REQUIRED" })).toBe("review");
  });

  it("is qa once the head is reviewed or the PR is approved, with CI green or absent", () => {
    expect(column({ headReviewed: true })).toBe("qa");
    expect(column({ ci: "none", headReviewed: true })).toBe("qa");
    expect(column({ review: "APPROVED" })).toBe("qa");
  });
});

describe("buildRepoBoard", () => {
  const cell = (session: string, branch: string) => ({ session, cwd: `/w/${session}`, working: true, waiting: false, branch });

  it("puts an issue no one claims in todo", () => {
    const cards = buildRepoBoard(input({ openIssues: [issue(4)] }));
    expect(cards).toEqual([{ key: "issue-4", column: "todo", issue: issue(4), pr: null, branch: null, cells: [] }]);
  });

  it("joins a PR to the issue it closes, with the title from the open list, and the cells on its branch", () => {
    const cards = buildRepoBoard(
      input({
        openPrs: [row({ number: 10, branch: "feat/a", headReviewed: true }, [{ number: 4, title: "", url: issue(4).url }])],
        openIssues: [issue(4)],
        cells: [cell("s1", "feat/a"), cell("s2", "feat/other-thing")],
      }),
    );
    const prCard = cards.find((card) => card.key === "pr-10");
    expect(prCard).toMatchObject({ column: "qa", issue: issue(4), branch: "feat/a" });
    expect(prCard?.cells.map((c) => c.session)).toEqual(["s1"]);
    expect(prCard?.cells[0]).not.toHaveProperty("branch");
    expect(cards.some((card) => card.key === "issue-4")).toBe(false);
  });

  it("keeps a closed issue's reference when it is not in the open list", () => {
    const cards = buildRepoBoard(input({ mergedPrs: [row({ number: 11 }, [{ number: 8, title: "", url: "https://github.com/o/r/issues/8" }])] }));
    expect(cards[0]).toMatchObject({ key: "pr-11", column: "merged", issue: { number: 8, title: "" } });
  });

  it("links a PR to an issue by its branch name only when that issue is open", () => {
    const cards = buildRepoBoard(
      input({ openPrs: [row({ number: 12, branch: "fix/5-thing" }), row({ number: 13, branch: "release/2026-07-hotfix" })], openIssues: [issue(5)] }),
    );
    expect(cards.find((card) => card.key === "pr-12")?.issue).toEqual(issue(5));
    expect(cards.find((card) => card.key === "pr-13")?.issue).toBeNull();
  });

  it("makes an implementing card for a cell on a branch with no PR, but not for the default branch", () => {
    const cards = buildRepoBoard(input({ openIssues: [issue(6)], cells: [cell("s1", "issue/6-x"), cell("s2", "main"), cell("s3", "issue/6-x")] }));
    expect(cards).toEqual([
      {
        key: "branch-issue/6-x",
        column: "implementing",
        issue: issue(6),
        pr: null,
        branch: "issue/6-x",
        cells: [expect.objectContaining({ session: "s1" }), expect.objectContaining({ session: "s3" })],
      },
    ]);
  });

  it("shows a cell on any branch when the default branch is unknown", () => {
    const cards = buildRepoBoard(input({ defaultBranch: null, cells: [cell("s1", "main")] }));
    expect(cards.map((card) => card.key)).toEqual(["branch-main"]);
  });

  it("orders cards by column and claims an issue once", () => {
    const cards = buildRepoBoard(
      input({
        openPrs: [
          row({ number: 20, headReviewed: true, branch: "a" }, [{ number: 1, title: "", url: "" }]),
          row({ number: 21, isDraft: true, branch: "b" }, [{ number: 1, title: "", url: "" }]),
        ],
        mergedPrs: [row({ number: 19, branch: "c" })],
        openIssues: [issue(1), issue(2)],
      }),
    );
    expect(cards.map((card) => `${card.column}:${card.key}`)).toEqual(["todo:issue-2", "implementing:pr-21", "qa:pr-20", "merged:pr-19"]);
    expect(cards.filter((card) => card.pr?.number !== 19).map((card) => card.issue?.number)).toEqual([2, 1, 1]);
  });

  it("still names the issue on a branch card when a PR already shows it", () => {
    const cards = buildRepoBoard(
      input({
        openPrs: [row({ number: 30, branch: "feat/7-a" }, [{ number: 7, title: "", url: "" }])],
        openIssues: [issue(7)],
        cells: [cell("s1", "fix/7-b")],
      }),
    );
    expect(cards.map((card) => card.key)).toEqual(["branch-fix/7-b", "pr-30"]);
    expect(cards.find((card) => card.key === "branch-fix/7-b")?.issue).toEqual(issue(7));
  });

  it("is empty for an empty repo", () => {
    expect(buildRepoBoard(input({}))).toEqual([]);
  });
});

describe("mainlineCells", () => {
  const cell = (session: string, branch: string | null) => ({ session, cwd: `/w/${session}`, working: false, waiting: false, branch });

  it("keeps the cells on the default branch and on no branch, in order", () => {
    const cells = [cell("s1", "main"), cell("s2", "feat/x"), cell("s3", null), cell("s4", "main")];
    expect(mainlineCells(cells, "main").map((c) => c.session)).toEqual(["s1", "s3", "s4"]);
  });

  it("keeps only the cells on no branch when the default branch is unknown", () => {
    expect(mainlineCells([cell("s1", "main"), cell("s2", null)], null).map((c) => c.session)).toEqual(["s2"]);
  });

  it("is empty with no cells, or none on the default branch", () => {
    expect(mainlineCells([], "main")).toEqual([]);
    expect(mainlineCells([cell("s1", "feat/x")], "main")).toEqual([]);
  });

  it("gives a cell on no branch no card, whatever the default branch", () => {
    expect(buildRepoBoard(input({ cells: [cell("s1", null)] }))).toEqual([]);
    expect(buildRepoBoard(input({ defaultBranch: null, cells: [cell("s1", null)] }))).toEqual([]);
  });
});
