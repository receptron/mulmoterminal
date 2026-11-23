// A repository's declared `review` settings (#3407), read from the clone its work starts in — the
// recorded choice, else the first candidate, as the issue start picks it.
import type { ReviewSettings } from "../../common/reviewSettings.js";
import { defaultCloneOf } from "../../common/repoDirs.js";
import { getCwdPresets, getRepoDirs } from "../config/config-routes.js";
import { loadDirConfig } from "../config/dir/dir-config.js";
import { repoDirsFromPresets } from "./repo-dirs.js";

export async function repoReviewSettings(repo: string): Promise<ReviewSettings | null> {
  const dir = defaultCloneOf(await repoDirsFromPresets(getCwdPresets(), getRepoDirs()), repo);
  return dir === null ? null : loadDirConfig(dir).review;
}

export const requiredLgtmOfRepo = async (repo: string): Promise<number | null> => (await repoReviewSettings(repo))?.requiredLgtm ?? null;
