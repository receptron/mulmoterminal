// The open PR URL for a branch (the header "open this branch's PR" button). One `gh pr list --head`,
// cached briefly per (repo, branch) so /api/header — which fires on every focus / dir / session change —
// doesn't shell out to gh each time. Pure parse + injectable deps keep it unit-testable without gh.
import { runGh } from "./gh.js";
import { createTtlCache } from "./ttl-cache.js";

const CACHE_TTL_MS = 30_000;
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

export interface PrForBranchDeps {
  runGh?: typeof runGh;
  now?: () => number;
  ttlMs?: number;
}

// The open PR URL for `branch` in `repo`, or null when there's none (the button is then hidden).
// Never throws — a gh failure resolves to null (the button just doesn't show).
export async function prUrlForBranch(repo: string, branch: string, deps: PrForBranchDeps = {}): Promise<string | null> {
  const run = deps.runGh ?? runGh;
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? CACHE_TTL_MS;
  const key = `${repo}:${branch}`;
  const hit = cache.get(key, now, ttlMs);
  if (hit !== undefined) return hit;
  let url: string | null = null;
  try {
    const res = await run(["pr", "list", "--head", branch, "--repo", repo, "--state", "open", "--json", "url", "--limit", "1"]);
    if (res.ok) url = parsePrUrl(res.stdout);
  } catch {
    url = null;
  }
  cache.set(key, url, now);
  return url;
}

// Test-only: drop the cache so cases don't leak across each other.
export function clearPrUrlCache(): void {
  cache.clear();
}
