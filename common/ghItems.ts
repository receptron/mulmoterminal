// What GET /api/prs and GET /api/issues answer with — the wire shapes shared across the
// build boundary so the server's `gh` aggregation and the PrsOverlay that renders it can't
// drift. The normalizing/rollup logic stays server-side (git/ghItem.ts, git/prs.ts).

/** The fields every `gh` list row shares: identity (number, url) and display text. */
export interface GhItemBase {
  number: number;
  title: string;
  author: string;
  updatedAt: string;
  url: string;
}

export type IssueItem = GhItemBase;

/** Collapsed statusCheckRollup: any failure wins, else any unfinished check → pending. */
export type CiState = "passing" | "failing" | "pending" | "none";

export interface PrItem extends GhItemBase {
  isDraft: boolean;
  review: string | null; // gh reviewDecision (APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED / null)
  ci: CiState;
}

export interface RepoPrs {
  repo: string;
  prs?: PrItem[];
  error?: string;
  // True when the repo has at least PR_LIMIT open PRs, so the list may be incomplete —
  // surfaced in the UI so a truncated view isn't mistaken for full coverage.
  truncated?: boolean;
  /** Read only because a live cell is in it: not in `prRepos`. */
  unregistered?: boolean;
}

export interface RepoIssues {
  repo: string;
  issues?: IssueItem[];
  error?: string;
  // True when the repo has more than ISSUE_LIMIT open issues, so the list is capped —
  // the UI then links to the repo's issues page for the rest.
  truncated?: boolean;
  // The repo's GitHub issues page, used as the "see the rest" target when truncated.
  url?: string;
  /** Read only because a live cell is in it: not in `prRepos`. */
  unregistered?: boolean;
}
