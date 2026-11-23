// The GitHub board's decisions (#3172), pure: what a `gh pr list` row says about review progress,
// which column a piece of work is in, and how PRs, issues and live cells fold into cards. The `gh`
// calls and the session lookups that feed it are in board-fetch.ts.
import {
  BOARD_COLUMNS,
  type BoardCard,
  type BoardCell,
  type BoardColumn,
  type BoardIssue,
  type BoardMainlineCell,
  type BoardPr,
} from "../../common/githubBoard.js";
import { issueCandidateFromBranch } from "../../common/prPhase.js";
import { isRecord } from "../../common/isRecord.js";
import { readString } from "../../common/readString.js";
import { rollupCiState } from "./prs.js";
import { codexReviewOf } from "./codexVerdict.js";

/** A PR row with what the board needs beyond the card: the issues it closes in this repo. */
export interface BoardPrRow {
  pr: BoardPr;
  closes: BoardIssue[];
}

/** A live cell and the branch its directory is on; null when HEAD is detached. */
export interface CellOnBranch extends BoardCell {
  branch: string | null;
}

export interface RepoBoardInput {
  repo: string;
  defaultBranch: string | null;
  openPrs: readonly BoardPrRow[];
  mergedPrs: readonly BoardPrRow[];
  openIssues: readonly BoardIssue[];
  cells: readonly CellOnBranch[];
}

const reviewedCommits = (reviews: unknown): Set<string> => {
  const oids = (Array.isArray(reviews) ? reviews : []).map((review) => (isRecord(review) && isRecord(review.commit) ? readString(review.commit.oid) : ""));
  return new Set(oids.filter((oid) => oid !== ""));
};

// `closingIssuesReferences` can name an issue in ANOTHER repository; a card only shows one of its own.
const closesInRepo = (refs: unknown, repo: string): BoardIssue[] => {
  const prefix = `https://github.com/${repo}/issues/`.toLowerCase();
  return (Array.isArray(refs) ? refs : []).flatMap((ref): BoardIssue[] => {
    if (!isRecord(ref) || typeof ref.number !== "number") return [];
    const url = readString(ref.url);
    return url.toLowerCase().startsWith(prefix) ? [{ number: ref.number, title: readString(ref.title), url }] : [];
  });
};

/** One `gh pr list --json` row, or null when it lacks the identity fields. */
export function parseBoardPr(raw: unknown, repo: string, requiredLgtm: number | null = null): BoardPrRow | null {
  if (!isRecord(raw) || typeof raw.number !== "number" || typeof raw.url !== "string") return null;
  const reviewed = reviewedCommits(raw.reviews);
  const pr: BoardPr = {
    number: raw.number,
    title: readString(raw.title),
    url: raw.url,
    branch: readString(raw.headRefName),
    isDraft: raw.isDraft === true,
    ci: rollupCiState(raw.statusCheckRollup),
    review: readString(raw.reviewDecision) || null,
    reviewRounds: reviewed.size,
    headReviewed: reviewed.has(readString(raw.headRefOid)),
    codex: codexReviewOf(raw.comments, raw.reviews, readString(raw.headRefOid)),
    requiredLgtm,
  };
  return { pr, closes: closesInRepo(raw.closingIssuesReferences, repo) };
}

/** Where an OPEN PR stands. Needs-the-author first, then waiting-on-review, then ready for QA. */
export function openPrColumn(pr: BoardPr): BoardColumn {
  const review = (pr.review ?? "").toUpperCase();
  if (pr.isDraft || pr.ci === "failing" || review === "CHANGES_REQUESTED") return "implementing";
  if (pr.ci === "pending") return "review";
  if (review === "APPROVED" || pr.headReviewed) return "qa";
  return "review";
}

const cellsByBranch = (cells: readonly CellOnBranch[]): Map<string, BoardCell[]> => {
  const out = new Map<string, BoardCell[]>();
  cells.forEach(({ branch, ...cell }) => {
    if (branch !== null) out.set(branch, [...(out.get(branch) ?? []), cell]);
  });
  return out;
};

// A branch-name number is only a candidate (`release/2026-…`); an open issue of that number is the
// confirmation it needs before a card claims it.
const issueOfBranch = (branch: string, openIssues: ReadonlyMap<number, BoardIssue>): BoardIssue | null => {
  const candidate = issueCandidateFromBranch(branch);
  return candidate === null ? null : (openIssues.get(candidate) ?? null);
};

// The closing reference carries no title; the open issue list does, when the issue is still open.
const issueOfPr = (row: BoardPrRow, openIssues: ReadonlyMap<number, BoardIssue>): BoardIssue | null => {
  const ref = row.closes[0];
  if (ref) return openIssues.get(ref.number) ?? ref;
  return issueOfBranch(row.pr.branch, openIssues);
};

const prCard = (row: BoardPrRow, column: BoardColumn, issue: BoardIssue | null, cells: BoardCell[]): BoardCard => ({
  key: `pr-${row.pr.number}`,
  column,
  issue,
  pr: row.pr,
  branch: row.pr.branch || null,
  cells,
});

const columnRank = (column: BoardColumn): number => BOARD_COLUMNS.indexOf(column);

// What the PR cards have taken: a claimed issue gets no todo card and a claimed branch no branch card.
interface Claims {
  issues: Set<number>;
  branches: Set<string>;
}

interface BoardContext {
  openIssues: ReadonlyMap<number, BoardIssue>;
  cells: ReadonlyMap<string, BoardCell[]>;
  claims: Claims;
}

const claimIssue = (claims: Claims, issue: BoardIssue | null): BoardIssue | null => {
  if (issue) claims.issues.add(issue.number);
  return issue;
};

const prCards = (context: BoardContext, rows: readonly BoardPrRow[], columnOf: (pr: BoardPr) => BoardColumn): BoardCard[] =>
  rows.map((row) => {
    context.claims.branches.add(row.pr.branch);
    const issue = claimIssue(context.claims, issueOfPr(row, context.openIssues));
    return prCard(row, columnOf(row.pr), issue, context.cells.get(row.pr.branch) ?? []);
  });

// Work a cell is doing on a branch that has no PR yet. The default branch is not a piece of work.
const branchCards = (context: BoardContext, defaultBranch: string | null): BoardCard[] =>
  [...context.cells.entries()]
    .filter(([branch]) => branch !== defaultBranch && !context.claims.branches.has(branch))
    .map(([branch, cells]): BoardCard => {
      const issue = claimIssue(context.claims, issueOfBranch(branch, context.openIssues));
      return { key: `branch-${branch}`, column: "implementing", issue, pr: null, branch, cells };
    });

const todoCards = (context: BoardContext): BoardCard[] =>
  [...context.openIssues.values()]
    .filter((issue) => !context.claims.issues.has(issue.number))
    .map((issue): BoardCard => ({ key: `issue-${issue.number}`, column: "todo", issue, pr: null, branch: null, cells: [] }));

/** The cells no card can carry: on no branch, or on the default branch. With the default branch unknown
 *  only the first, since a cell on any branch then gets a branch card. */
export const mainlineCells = (cells: readonly CellOnBranch[], defaultBranch: string | null): BoardMainlineCell[] =>
  cells.filter((cell) => cell.branch === null || cell.branch === defaultBranch);

/** Every card for one repo, in column order. Each PR is one card, showing its issue even when another
 *  PR closes the same one; an issue or branch that a card already shows gets no card of its own. */
export function buildRepoBoard(input: RepoBoardInput): BoardCard[] {
  const context: BoardContext = {
    openIssues: new Map(input.openIssues.map((issue) => [issue.number, issue])),
    cells: cellsByBranch(input.cells),
    claims: { issues: new Set(), branches: new Set() },
  };
  const cards = [
    ...prCards(context, input.openPrs, openPrColumn),
    ...prCards(context, input.mergedPrs, () => "merged"),
    ...branchCards(context, input.defaultBranch),
    ...todoCards(context),
  ];
  return cards.sort((a, b) => columnRank(a.column) - columnRank(b.column));
}
