// Aggregate open issues across the user's configured repos via the `gh` CLI, mirroring
// prs.ts. One `gh issue list` per repo in parallel; a failing repo yields a per-repo
// error instead of sinking the view. The pure normalize helper is unit-tested.
import { runGh } from "./gh";
import { normalizeGhItemBase, type GhItemBase } from "./ghItem";

export type IssueItem = GhItemBase;

export interface RepoIssues {
  repo: string;
  issues?: IssueItem[];
  error?: string;
  // True when the repo has more than ISSUE_LIMIT open issues, so the list is capped —
  // the UI then links to the repo's issues page for the rest.
  truncated?: boolean;
  // The repo's GitHub issues page, used as the "see the rest" target when truncated.
  url?: string;
}

// Per-repo cap. Small on purpose: this is a glanceable digest, and overflow is one
// click away on GitHub (unlike the PR view, which is the primary place PRs are read).
export const ISSUE_LIMIT = 20;

// An issue row carries exactly the shared base fields.
export const normalizeIssue = normalizeGhItemBase;

const GH_FIELDS = "number,title,author,updatedAt,url";

export async function listIssuesAcrossRepos(repos: string[]): Promise<RepoIssues[]> {
  return Promise.all(
    repos.map(async (repo): Promise<RepoIssues> => {
      const issuesUrl = `https://github.com/${repo}/issues`;
      // Fetch one MORE than we display so `truncated` is a real observation
      // (rows > ISSUE_LIMIT), never a false positive at exactly ISSUE_LIMIT.
      const res = await runGh(["issue", "list", "--repo", repo, "--state", "open", "--limit", String(ISSUE_LIMIT + 1), "--json", GH_FIELDS]);
      if (!res.ok) return { repo, error: (res.stderr.trim() || "gh issue list failed").slice(0, 300) };
      try {
        const parsed: unknown = JSON.parse(res.stdout);
        const rows = Array.isArray(parsed) ? parsed : [];
        const truncated = rows.length > ISSUE_LIMIT;
        const issues = rows
          .slice(0, ISSUE_LIMIT)
          .map(normalizeIssue)
          .filter((i): i is IssueItem => i !== null);
        return { repo, issues, truncated, url: issuesUrl };
      } catch {
        return { repo, error: "could not parse gh output" };
      }
    }),
  );
}
