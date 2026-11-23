// What GET /api/github/board answers with (#3172): per repo, one card per piece of work — the issue,
// the PR that closes it, and the live cells on its branch — placed in a column. Shared because the
// server decides the column and the board renders it.
import type { CiState } from "./ghItems.js";

export const BOARD_COLUMNS = ["todo", "implementing", "review", "qa", "merged"] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export interface BoardIssue {
  number: number;
  title: string;
  url: string;
}

export interface BoardPr {
  number: number;
  title: string;
  url: string;
  branch: string;
  isDraft: boolean;
  ci: CiState;
  /** gh reviewDecision, or null when the repo requires none. */
  review: string | null;
  /** Distinct commits that received a review — one per push a reviewer looked at. */
  reviewRounds: number;
  /** Whether the newest commit has been reviewed yet. */
  headReviewed: boolean;
  /** Cross-review rounds, posted as comments; null when none was. */
  codex: BoardCodexReview | null;
  /** LGTMs on the current head the repository's `review` setting requires, or null when it declares none. */
  requiredLgtm: number | null;
}

export type CodexVerdict = "lgtm" | "changes";

export interface BoardCodexReview {
  /** Verdict comments posted by the repo's owner, members or collaborators. */
  verdicts: number;
  /** gh returned its cap of comments or of reviews, so there may be verdicts it did not return. */
  more: boolean;
  latest: CodexVerdict;
  /** Which head the newest verdict names: this PR's head, another commit, or none. */
  head: "current" | "stale" | "unknown";
  /** LGTM verdicts naming this PR's head. */
  lgtmOnHead: number;
}

/** The repository's declared merge condition, as requestReview reports it: the required LGTMs on the
 *  current head and every CI check passing. A repository that declares no `review` never meets it. */
export const mergeConditionMet = (pr: BoardPr): boolean =>
  pr.requiredLgtm !== null && !pr.isDraft && pr.ci === "passing" && (pr.codex?.lgtmOnHead ?? 0) >= pr.requiredLgtm;

export interface BoardCell {
  session: string;
  cwd: string;
  working: boolean;
  waiting: boolean;
}

/** A live cell on no piece of work: on the default branch, which `branch` names, or on no branch (null). */
export interface BoardMainlineCell extends BoardCell {
  branch: string | null;
}

export interface BoardCard {
  /** Stable within a repo: `pr-N`, `issue-N` or `branch-<name>`. */
  key: string;
  column: BoardColumn;
  issue: BoardIssue | null;
  pr: BoardPr | null;
  /** The branch the work is on, when there is one — the PR's head, or a cell's branch with no PR. */
  branch: string | null;
  cells: BoardCell[];
}

export interface RepoBoard {
  repo: string;
  cards?: BoardCard[];
  error?: string;
  /** Read only because a live cell is in it: not in `prRepos`. */
  unregistered?: boolean;
  /** The cells on the default branch or on no branch, which belong to no card. Absent when none. */
  mainlineCells?: BoardMainlineCell[];
}

export interface BoardResponse {
  repos: RepoBoard[];
}

// What GET /api/github/board/detail answers with (#3177): the parts of one card that the board's
// list does not carry, read when its detail panel opens.
export interface BoardIssueDetail {
  number: number;
  title: string;
  url: string;
  author: string;
  labels: string[];
  /** Markdown, as written on GitHub. */
  body: string;
}

export interface BoardCheck {
  name: string;
  ci: CiState;
  /** The check's own page, or "" when it has none. */
  url: string;
}

export interface BoardReview {
  author: string;
  /** gh's review state: APPROVED, CHANGES_REQUESTED, COMMENTED, … */
  state: string;
  /** The short oid of the commit the review was left on. */
  commit: string;
  submittedAt: string;
}

export interface BoardPrDetail {
  number: number;
  title: string;
  url: string;
  author: string;
  body: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  checks: BoardCheck[];
  reviews: BoardReview[];
}

export interface BoardDetailResponse {
  issue: BoardIssueDetail | null;
  pr: BoardPrDetail | null;
  /** One line per part that could not be read; the other part is still shown. */
  errors: string[];
}
