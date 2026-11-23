// The route behind the reviewSettings tool (#3407): a repository's declared `review` settings, read
// from the clone this machine starts that repository's work in. Keyed by REPOSITORY rather than the
// caller's directory, because the session that drives a review works on issues of any repository.
import type { Express } from "express";
import { isRecord } from "../../common/isRecord.js";
import { isRepoEntry } from "../../common/repoEntry.js";
import type { ReviewSettings } from "../../common/reviewSettings.js";

export interface ReviewSettingsRouteDeps {
  /** The clone work on `repo` starts in, or null when this machine knows none. */
  cloneOf: (repo: string) => Promise<string | null>;
  reviewOf: (dir: string) => ReviewSettings | null;
}

/** What the calling agent is told, and the settings when there are any. */
export function reviewSettingsAnswer(repo: string, dir: string | null, review: ReviewSettings | null): { message: string; jsonData?: unknown } {
  if (dir === null) return { message: `No local clone of ${repo} is known to MulmoTerminal, so its review settings cannot be read.` };
  if (review === null)
    return { message: `${repo} (${dir}) declares no review settings: no \`review\` in its .mulmoterminal.json, or one that does not validate.` };
  const { reviewer, maxRounds, requiredLgtm } = review;
  return {
    message: `${repo} (${dir}): reviewer ${reviewer}, at most ${maxRounds} rounds, mergeable with ${requiredLgtm} LGTM on the current head and every CI check passing.`,
    jsonData: { repo, dir, ...review },
  };
}

export function mountReviewSettingsRoute(app: Express, deps: ReviewSettingsRouteDeps): void {
  app.post("/api/plugin/reviewSettings", async (req, res) => {
    const repo = isRecord(req.body) && typeof req.body.repo === "string" ? req.body.repo.trim() : "";
    if (!isRepoEntry(repo)) return res.json({ message: "reviewSettings: `repo` must be a repository, as owner/repo." });
    const dir = await deps.cloneOf(repo);
    return res.json(reviewSettingsAnswer(repo, dir, dir === null ? null : deps.reviewOf(dir)));
  });
}
