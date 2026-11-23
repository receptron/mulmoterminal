// The PR an implementer opened from its branch, and where it stands (#3413). GitHub only, as
// startIssueSession is. The newest PR from the branch is the one that counts: a closed first attempt
// followed by a merged second one is a merge.
import { isRecord } from "../../common/isRecord.js";
import { readString } from "../../common/readString.js";
import { runGh } from "./gh.js";
import type { PrState } from "../routes/issueSessionWatch.js";

export interface BranchPr {
  number: number;
  state: PrState;
}

const isPrState = (value: string): value is PrState => value === "OPEN" || value === "MERGED" || value === "CLOSED";

/** `gh pr list --json number,state` output, newest first, as the newest PR — or null when there is none. */
export function parseBranchPr(stdout: string): BranchPr | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const rows: unknown[] = parsed;
  const newest = rows.find((row) => isRecord(row) && typeof row.number === "number" && isPrState(readString(row.state)));
  if (!isRecord(newest) || typeof newest.number !== "number") return null;
  const state = readString(newest.state);
  return isPrState(state) ? { number: newest.number, state } : null;
}

/** Null when there is no PR yet, and also when gh could not be asked: the next look asks again. */
export async function fetchBranchPr(repo: string, branch: string): Promise<BranchPr | null> {
  const result = await runGh(["pr", "list", "--repo", repo, "--head", branch, "--state", "all", "--json", "number,state", "--limit", "5"]);
  return result.ok ? parseBranchPr(result.stdout) : null;
}
