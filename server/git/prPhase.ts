// The workflow phase of a branch's pull request, for the grid's cockpit roster: is this
// cell's work sitting in the PR review loop, ready to merge, already merged, or has no PR
// yet? An open-first `gh pr list --head` (one call, or a second `--state all` only when
// there's no open PR), cached briefly per (repo, branch) so a per-cell roster poll doesn't
// shell out to gh every tick. Pure parse + derivation keep it unit-testable.
//
// The cwd → (repo, branch) resolution lives at the route (server/index.ts), same as the
// header's PR button — this module takes an already-resolved repo/branch so it stays free
// of the config/header layer.
import { runGh } from "./gh.js";
import { rollupCiState, type CiState } from "./prs.js";
import { createTtlCache } from "./ttl-cache.js";

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
const GH_FIELDS = "state,isDraft,reviewDecision,statusCheckRollup,url";
const cache = createTtlCache<PrPhaseResult>();

export interface PrPhaseDeps {
  runGh?: typeof runGh;
  now?: () => number;
  ttlMs?: number;
}

const NONE: PrPhaseResult = { phase: "none", url: null };

// The newest PR for `branch` in `state`. `ok` distinguishes "gh ran, no such PR" (pr:null)
// from "gh failed" — the caller must not treat a failed open-PR query as "no open PR", or a
// transient error would let a stale merged PR from a reused head win. Never throws.
async function listPr(run: typeof runGh, repo: string, branch: string, state: "open" | "all"): Promise<{ ok: boolean; pr: ParsedPr | null }> {
  try {
    const res = await run(["pr", "list", "--head", branch, "--repo", repo, "--state", state, "--json", GH_FIELDS, "--limit", "1"]);
    return res.ok ? { ok: true, pr: parsePrList(res.stdout)[0] ?? null } : { ok: false, pr: null };
  } catch {
    return { ok: false, pr: null };
  }
}

// The PR phase for `branch`. An OPEN PR (there's at most one per head branch) is the current
// state, queried first so it can't be masked by stale merged/closed PRs from a reused head —
// only when the open query genuinely returns none do we look at `--state all`. A failed query
// resolves to `none` and is NOT cached, so the next roster poll retries instead of showing a
// stale phase.
export async function phaseForRepoBranch(repo: string, branch: string, deps: PrPhaseDeps = {}): Promise<PrPhaseResult> {
  const run = deps.runGh ?? runGh;
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? CACHE_TTL_MS;
  const key = `${repo}:${branch}`;
  const hit = cache.get(key, now, ttlMs);
  if (hit !== undefined) return hit;

  const open = await listPr(run, repo, branch, "open");
  if (!open.ok) return NONE;
  let pr = open.pr;
  if (!pr) {
    const all = await listPr(run, repo, branch, "all");
    if (!all.ok) return NONE;
    pr = all.pr;
  }
  const result: PrPhaseResult = { phase: derivePrPhase(pr), url: pr?.url ?? null };
  cache.set(key, result, now);
  return result;
}

// Test-only: drop the cache so cases don't leak across each other.
export function clearPrPhaseCache(): void {
  cache.clear();
}
