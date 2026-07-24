// The open PR URL for a branch (the header "open this branch's PR" button). One `gh pr list --head`,
// cached briefly per (repo, branch) so /api/header — which fires on every focus / dir / session change —
// doesn't shell out to gh each time. Pure parse + injectable deps keep it unit-testable without gh.
import { createTtlCache } from "./ttl-cache.js";
import { branchQuery, type BranchQueryDeps } from "./branch-query.js";

const cache = createTtlCache<string | null>();

// The first url in `gh pr list --json url` output, or null (no open PR / malformed).
export function parsePrUrl(stdout: string): string | null {
  try {
    const arr: unknown = JSON.parse(stdout);
    if (Array.isArray(arr) && arr.length > 0) {
      const first: unknown = arr[0];
      if (typeof first === "object" && first !== null && typeof (first as { url?: unknown }).url === "string") {
        return (first as { url: string }).url;
      }
    }
  } catch {
    // malformed JSON → treat as no PR
  }
  return null;
}

export type PrForBranchDeps = BranchQueryDeps;

// The open PR URL for `branch` in `repo`, or null when there's none (the button is then hidden).
// Never throws — a gh failure resolves to null (the button just doesn't show).
export async function prUrlForBranch(repo: string, branch: string, deps: PrForBranchDeps = {}): Promise<string | null> {
  const { run, now, ttlMs, key } = branchQuery(deps, repo, branch);
  const hit = cache.get(key, now, ttlMs);
  if (hit !== undefined) return hit;
  try {
    const res = await run(["pr", "list", "--head", branch, "--repo", repo, "--state", "open", "--json", "url", "--limit", "1"]);
    if (res.ok) {
      // Cache only a REAL answer. A gh failure (offline, unauthed, rate-limited) must not be
      // cached as "no PR" — that would hide the button for the whole TTL even after gh
      // recovers. On failure we return null WITHOUT caching, so the next call retries.
      const url = parsePrUrl(res.stdout);
      cache.set(key, url, now);
      return url;
    }
  } catch {
    // fall through — transient failure, not cached
  }
  return null;
}

// Test-only: drop the cache so cases don't leak across each other.
export function clearPrUrlCache(): void {
  cache.clear();
}
