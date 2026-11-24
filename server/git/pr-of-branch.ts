// The PR an implementer opened from its branch, and where it stands (#3413). GitHub only, as
// startIssueSession is. The newest PR from the branch is the one that counts: a closed first attempt
// followed by a merged second one is a merge. One that was already closed or merged when the
// implementer started is an earlier attempt's, not its answer (#3440): the issue's branch keeps its
// name from one start to the next.
import { isRecord } from "../../common/isRecord.js";
import { readString } from "../../common/readString.js";
import { runGh } from "./gh.js";
import { PR_UNREADABLE, type PrState } from "../routes/issueSessionWatch.js";

export interface BranchPr {
  number: number;
  state: PrState;
}

const isPrState = (value: string): value is PrState => value === "OPEN" || value === "MERGED" || value === "CLOSED";

/** When a closed or merged row ended, in ms, or null when it does not say in a form that parses. */
function endedAtMs(row: Record<string, unknown>): number | null {
  const at = Date.parse(readString(row.mergedAt) || readString(row.closedAt));
  return Number.isNaN(at) ? null : at;
}

/** A row that was already over before `sinceMs`. A row that does not say when it ended counts, as
 *  it did before the time was asked for. */
const endedBefore = (row: Record<string, unknown>, sinceMs: number): boolean => {
  if (readString(row.state) === "OPEN") return false;
  const at = endedAtMs(row);
  return at !== null && at < sinceMs;
};

/** `gh pr list --json number,state,closedAt,mergedAt` output, newest first, as the newest PR that was
 *  not already over before `sinceMs` — null when there is none, PR_UNREADABLE when the answer is not
 *  a list at all. */
export function parseBranchPr(stdout: string, sinceMs: number): BranchPr | null | typeof PR_UNREADABLE {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return PR_UNREADABLE;
  }
  if (!Array.isArray(parsed)) return PR_UNREADABLE;
  const rows: unknown[] = parsed;
  const newest = rows.find((row) => isRecord(row) && typeof row.number === "number" && isPrState(readString(row.state)) && !endedBefore(row, sinceMs));
  if (!isRecord(newest) || typeof newest.number !== "number") return null;
  const state = readString(newest.state);
  return isPrState(state) ? { number: newest.number, state } : null;
}

/** Null when there is no PR yet; PR_UNREADABLE when gh could not be asked, which is not the same. */
export async function fetchBranchPr(repo: string, branch: string, sinceMs: number): Promise<BranchPr | null | typeof PR_UNREADABLE> {
  const result = await runGh(["pr", "list", "--repo", repo, "--head", branch, "--state", "all", "--json", "number,state,closedAt,mergedAt", "--limit", "5"]);
  return result.ok ? parseBranchPr(result.stdout, sinceMs) : PR_UNREADABLE;
}
