// Aggregate open PRs across the user's configured repos via the `gh` CLI (its own
// login is the auth). One `gh pr list` per repo, run in parallel; a repo that errors
// (missing, no access, gh not installed) yields a per-repo error instead of failing
// the whole view. The pure normalize/rollup helpers are unit-tested without gh.
import { runGh } from "./gh";
import { isRecord, normalizeGhItemBase, type GhItemBase } from "./ghItem";

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
}

// Per-repo cap. High enough for a review dashboard; a repo that hits it is flagged
// `truncated` rather than silently cut.
export const PR_LIMIT = 100;

const FAIL = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const OK = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

// Collapse a PR's statusCheckRollup (mixed CheckRun {status,conclusion} + StatusContext
// {state}) into one glanceable state: any failure wins, else any not-yet-successful
// check → pending, else passing. Empty rollup → none.
export function rollupCiState(checks: unknown): CiState {
  if (!Array.isArray(checks) || checks.length === 0) return "none";
  let anyPending = false;
  for (const c of checks) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const conclusion = String(o.conclusion ?? "").toUpperCase();
    const state = String(o.state ?? "").toUpperCase();
    if (FAIL.has(conclusion) || state === "FAILURE" || state === "ERROR") return "failing";
    if (!(OK.has(conclusion) || state === "SUCCESS")) anyPending = true;
  }
  return anyPending ? "pending" : "passing";
}

export function normalizePr(raw: unknown): PrItem | null {
  const base = normalizeGhItemBase(raw);
  // isRecord(raw) is implied by a non-null base; it re-narrows raw for the extra fields
  // without an `as` cast.
  if (!base || !isRecord(raw)) return null;
  return {
    ...base,
    isDraft: raw.isDraft === true,
    review: typeof raw.reviewDecision === "string" && raw.reviewDecision ? raw.reviewDecision : null,
    ci: rollupCiState(raw.statusCheckRollup),
  };
}

const GH_FIELDS = "number,title,author,updatedAt,isDraft,url,reviewDecision,statusCheckRollup";

export async function listPrsAcrossRepos(repos: string[]): Promise<RepoPrs[]> {
  return Promise.all(
    repos.map(async (repo): Promise<RepoPrs> => {
      // Fetch one MORE than we display so "there are more" is a real observation
      // (rows > PR_LIMIT), never a false positive at exactly PR_LIMIT.
      const res = await runGh(["pr", "list", "--repo", repo, "--state", "open", "--limit", String(PR_LIMIT + 1), "--json", GH_FIELDS]);
      if (!res.ok) return { repo, error: (res.stderr.trim() || "gh pr list failed").slice(0, 300) };
      try {
        const parsed: unknown = JSON.parse(res.stdout);
        const rows = Array.isArray(parsed) ? parsed : [];
        const truncated = rows.length > PR_LIMIT;
        const prs = rows
          .slice(0, PR_LIMIT)
          .map(normalizePr)
          .filter((p): p is PrItem => p !== null);
        return { repo, prs, truncated };
      } catch {
        return { repo, error: "could not parse gh output" };
      }
    }),
  );
}
