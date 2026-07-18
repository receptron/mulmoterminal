// The workflow phase of a branch's pull request, for the grid's cockpit roster: is this
// cell's work sitting in the PR review loop, ready to merge, already merged, or has no PR
// yet? One `gh pr list --head`, cached briefly per (repo, branch) so a per-cell roster poll
// doesn't shell out to gh every tick. Pure parse + derivation keep it unit-testable.
//
// The cwd → (repo, branch) resolution lives at the route (server/index.ts), same as the
// header's PR button — this module takes an already-resolved repo/branch so it stays free
// of the config/header layer.
import { runGh } from "./gh.js";
import { rollupCiState, type CiState } from "./prs.js";

// Ordered roughly along the lifecycle so the client can pick a colour/label per phase.
// `none` = no PR for this branch yet (still local work); `ready` = open, CI green, no
// changes requested — i.e. waiting to merge.
export type PrPhase = "none" | "draft" | "ci-failing" | "changes-requested" | "ci-running" | "ready" | "merged" | "closed";

export interface ParsedPr {
  state: string; // OPEN | MERGED | CLOSED
  isDraft: boolean;
  reviewDecision: string; // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | ""
  ci: CiState; // passing | failing | pending | none
  url: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const toParsedPr = (o: Record<string, unknown>): ParsedPr => ({
  state: typeof o.state === "string" ? o.state : "",
  isDraft: o.isDraft === true,
  reviewDecision: typeof o.reviewDecision === "string" ? o.reviewDecision : "",
  ci: rollupCiState(o.statusCheckRollup),
  url: typeof o.url === "string" ? o.url : null,
});

// Every PR in `gh pr list --json ...` output (empty on malformed / no PRs).
export function parsePrList(stdout: string): ParsedPr[] {
  let arr: unknown;
  try {
    arr = JSON.parse(stdout);
  } catch {
    return [];
  }
  return Array.isArray(arr) ? arr.filter(isRecord).map(toParsedPr) : [];
}

// The PR that represents the branch's CURRENT state: an OPEN PR always wins over a
// historical merged/closed one (a head branch can be reused, so `--state all` may also
// list stale PRs). With no open PR, the newest entry (gh lists newest-first) gives the
// merged/closed result.
export function selectCurrentPr(prs: ParsedPr[]): ParsedPr | null {
  return prs.find((p) => p.state.toUpperCase() === "OPEN") ?? prs[0] ?? null;
}

// Pure lifecycle mapping. For an OPEN PR the order encodes what needs attention first:
// still a draft → CI failing → review asked for changes → CI still running → otherwise
// green and unblocked (ready to merge).
export function derivePrPhase(pr: ParsedPr | null): PrPhase {
  if (!pr) return "none";
  const state = pr.state.toUpperCase();
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  if (pr.isDraft) return "draft";
  if (pr.ci === "failing") return "ci-failing";
  if (pr.reviewDecision.toUpperCase() === "CHANGES_REQUESTED") return "changes-requested";
  if (pr.ci === "pending") return "ci-running";
  return "ready";
}

export interface PrPhaseResult {
  phase: PrPhase;
  url: string | null;
}

const CACHE_TTL_MS = 30_000;
// `--state all` (with an open-first selection) so a just-merged branch reads as `merged`,
// not `none`; the limit lets an open PR outrank stale same-head PRs from branch reuse.
const GH_FIELDS = "state,isDraft,reviewDecision,statusCheckRollup,url";
const GH_LIMIT = "10";
interface CacheEntry {
  result: PrPhaseResult;
  at: number;
}
const cache = new Map<string, CacheEntry>();

export interface PrPhaseDeps {
  runGh?: typeof runGh;
  now?: () => number;
  ttlMs?: number;
}

// The PR phase for `branch` in `repo`. Never throws — a gh failure resolves to `none`.
export async function phaseForRepoBranch(repo: string, branch: string, deps: PrPhaseDeps = {}): Promise<PrPhaseResult> {
  const run = deps.runGh ?? runGh;
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? CACHE_TTL_MS;
  const key = `${repo}:${branch}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < ttlMs) return hit.result;
  let result: PrPhaseResult = { phase: "none", url: null };
  try {
    const res = await run(["pr", "list", "--head", branch, "--repo", repo, "--state", "all", "--json", GH_FIELDS, "--limit", GH_LIMIT]);
    if (res.ok) {
      const pr = selectCurrentPr(parsePrList(res.stdout));
      result = { phase: derivePrPhase(pr), url: pr?.url ?? null };
    }
  } catch {
    result = { phase: "none", url: null };
  }
  cache.set(key, { result, at: now() });
  return result;
}

// Test-only: drop the cache so cases don't leak across each other.
export function clearPrPhaseCache(): void {
  cache.clear();
}
