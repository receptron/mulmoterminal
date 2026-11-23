// One PR's state as the review loop needs it (#3409): open or not, the head a round reviews, and CI.
// GitHub only — the loop's verdict lives in a PR comment, which is how this repository's reviews post.
import { isRecord } from "../../common/isRecord.js";
import { readString } from "../../common/readString.js";
import type { CiState } from "../../common/ghItems.js";
import { runGh } from "./gh.js";
import { rollupCiState } from "./prs.js";

export interface PrReviewState {
  open: boolean;
  /** Lower case, as the verdict lines name it. */
  head: string;
  ci: CiState;
}

const FIELDS = "state,headRefOid,statusCheckRollup";
const ERROR_MAX_CHARS = 300;

/** `gh pr view --json` output, or null when it is not a PR's. */
export function parsePrReviewState(stdout: string): PrReviewState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const head = readString(parsed.headRefOid).toLowerCase();
  if (head === "") return null;
  return { open: readString(parsed.state) === "OPEN", head, ci: rollupCiState(parsed.statusCheckRollup) };
}

export async function fetchPrReviewState(repo: string, pr: number): Promise<PrReviewState | string> {
  const result = await runGh(["pr", "view", String(pr), "--repo", repo, "--json", FIELDS]);
  if (!result.ok) return (result.stderr.trim() || `gh pr view ${pr} --repo ${repo} failed`).slice(0, ERROR_MAX_CHARS);
  return parsePrReviewState(result.stdout) ?? `could not read gh's answer for ${repo}#${pr}`;
}
