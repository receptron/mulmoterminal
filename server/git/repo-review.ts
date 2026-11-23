// A repository's declared `review` settings (#3407), read from the clone its work starts in — the
// recorded choice, else the first candidate, as the issue start picks it.
import type { ReviewSettings } from "../../common/reviewSettings.js";
import { defaultCloneOf, type RepoDirs } from "../../common/repoDirs.js";
import { getCwdPresets, getRepoDirs } from "../config/config-routes.js";
import { loadDirConfig } from "../config/dir/dir-config.js";
import { repoDirsFromPresets } from "./repo-dirs.js";

const reviewIn = (entries: readonly RepoDirs[], repo: string): ReviewSettings | null => {
  const dir = defaultCloneOf(entries, repo);
  return dir === null ? null : loadDirConfig(dir).review;
};

export async function repoReviewSettings(repo: string): Promise<ReviewSettings | null> {
  return reviewIn(await repoDirsFromPresets(getCwdPresets(), getRepoDirs()), repo);
}

/** Required LGTMs per repository for one board load: the clones are found once (a git read per saved
 *  directory), however many repositories the board shows. */
export function requiredLgtmLookup(): (repo: string) => Promise<number | null> {
  let entries: Promise<RepoDirs[]> | null = null;
  return async (repo) => {
    entries ??= repoDirsFromPresets(getCwdPresets(), getRepoDirs());
    return reviewIn(await entries, repo)?.requiredLgtm ?? null;
  };
}
