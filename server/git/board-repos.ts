// Which repos the board reads beyond the configured ones (#3372), pure.
import { repoIdentity } from "../../common/repoEntry.js";

/** The repos a live cell is in that are not configured, each once and by the name first seen, sorted. */
export const unconfiguredRepos = (configured: readonly string[], cellRepos: readonly string[]): string[] => {
  const known = new Set(configured.map(repoIdentity));
  const byIdentity = new Map<string, string>();
  cellRepos.forEach((repo) => {
    const identity = repoIdentity(repo);
    if (!known.has(identity) && !byIdentity.has(identity)) byIdentity.set(identity, repo);
  });
  return [...byIdentity.values()].sort((a, b) => a.localeCompare(b));
};
