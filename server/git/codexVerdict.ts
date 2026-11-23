// Codex cross-review verdicts on a PR (#3196), pure: a codex round is posted as a plain comment (or
// review body) whose first line is `CODEX VERDICT: LGTM (head <sha>)`, so GitHub's review list never
// sees it. This reads those lines out of a `gh pr list` row's comments and reviews.
import type { BoardCodexReview, CodexVerdict } from "../../common/githubBoard.js";
import { isRecord } from "../../common/isRecord.js";
import { readString } from "../../common/readString.js";

/** `gh pr list` returns a PR's first this-many comments, and its first this-many reviews, and no more. */
export const GH_LIST_ITEM_CAP = 100;

// Anyone may comment on a public repo; only the repo's own people can post a verdict the board counts.
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

// What follows the verdict is not anchored: some verdicts were posted with a backslash-n typed after it.
const VERDICT_OPENING = /^CODEX VERDICT: (LGTM|CHANGES REQUESTED)\b/i;

const HEAD_NAMED = /^ \(head ([0-9a-f]{7,40})\)/i;

export interface VerdictLine {
  verdict: CodexVerdict;
  /** The head the round reviewed, lower case, or "" when the line names none. */
  sha: string;
}

/** The verdict a comment body opens with, or null when it does not open with one. */
export function parseVerdictLine(body: string): VerdictLine | null {
  const opening = VERDICT_OPENING.exec(body);
  const word = opening?.[1];
  if (!opening || word === undefined) return null;
  const sha = HEAD_NAMED.exec(body.slice(opening[0].length))?.[1] ?? "";
  return { verdict: word.toUpperCase() === "LGTM" ? "lgtm" : "changes", sha: sha.toLowerCase() };
}

interface PostedVerdict extends VerdictLine {
  at: string;
}

// A comment carries `createdAt`, a review `submittedAt`; both are ISO times in UTC, so they sort as text.
// A review the viewer has saved but not submitted comes back with no time, and nobody else can see it.
const postedVerdicts = (items: unknown, timeField: "createdAt" | "submittedAt"): PostedVerdict[] =>
  (Array.isArray(items) ? items : []).flatMap((item): PostedVerdict[] => {
    if (!isRecord(item) || !TRUSTED_ASSOCIATIONS.has(readString(item.authorAssociation))) return [];
    const line = parseVerdictLine(readString(item.body));
    const at = readString(item[timeField]);
    return line && at !== "" ? [{ ...line, at }] : [];
  });

const reachedCap = (items: unknown): boolean => Array.isArray(items) && items.length >= GH_LIST_ITEM_CAP;

const headState = (sha: string, headOid: string): BoardCodexReview["head"] => {
  if (sha === "") return "unknown";
  return headOid !== "" && headOid.toLowerCase().startsWith(sha) ? "current" : "stale";
};

/** What the codex rounds on one PR come to, or null when none was posted or the comments were not read. */
export function codexReviewOf(comments: unknown, reviews: unknown, headOid: string): BoardCodexReview | null {
  // A row read without comments (the merged list) would otherwise get a count of its review verdicts alone.
  if (!Array.isArray(comments)) return null;
  const verdicts = [...postedVerdicts(comments, "createdAt"), ...postedVerdicts(reviews, "submittedAt")];
  const latest = verdicts.reduce<PostedVerdict | null>((newest, verdict) => (newest === null || verdict.at >= newest.at ? verdict : newest), null);
  if (!latest) return null;
  return {
    verdicts: verdicts.length,
    more: reachedCap(comments) || reachedCap(reviews),
    latest: latest.verdict,
    head: headState(latest.sha, headOid),
    lgtmOnHead: verdicts.filter((verdict) => verdict.verdict === "lgtm" && headState(verdict.sha, headOid) === "current").length,
  };
}
