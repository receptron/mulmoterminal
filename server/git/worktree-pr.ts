// Outward-facing worktree actions (the "取り込み" half): push the worktree's branch
// and open/create a PR. PR creation prefers `gh pr create`; when gh is missing or
// unauthed it falls back to opening the GitHub compare URL in the browser. Guarded
// upstream by origin checks; here every command is argv-only (no shell).
import { repoRoot, defaultBaseBranch, isManagedWorktree, git } from "./worktrees.js";
import { resolveGithubUrl } from "./gitRemote.js";
import { spawnCollect, type SpawnResult } from "./spawn-collect.js";
import { lastGhUrl } from "./git-parse.js";

type Reason = "not-worktree" | "no-branch" | "no-remote" | "no-github" | "push-failed" | "failed";

export interface PushResult {
  ok: boolean;
  branch?: string;
  reason?: Reason;
  detail?: string;
}
export interface PrResult {
  ok: boolean;
  url?: string;
  via?: "gh" | "compare";
  reason?: Reason;
  detail?: string;
}

const DETAIL_LIMIT = 500;

// `git push` and `gh pr create` are outward network mutations that can legitimately take
// minutes on a large branch or a slow remote — far longer than spawnCollect's default,
// which is tuned for quick `gh` reads. Give them a generous ceiling so a real push isn't
// killed at 30s and mis-reported as push-failed, while still bounding a truly-stuck process.
export const NETWORK_MUTATION_TIMEOUT_MS = 300_000;

// worktrees.ts' git() drops stderr and only runs git; push/gh failures report via
// stderr, so use the stderr-capturing runner, constrained to those two tools.
function run(cmd: "git" | "gh", args: string[], cwd: string): Promise<SpawnResult> {
  return spawnCollect(cmd, args, { cwd, errorStderr: "spawn failed", timeoutMs: NETWORK_MUTATION_TIMEOUT_MS });
}

async function currentBranch(cwd: string): Promise<string | null> {
  const res = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const branch = res.stdout.trim();
  return res.ok && branch && branch !== "HEAD" ? branch : null;
}

async function hasOrigin(cwd: string): Promise<boolean> {
  const res = await git(["remote"], cwd);
  return (
    res.ok &&
    res.stdout
      .split("\n")
      .map((r) => r.trim())
      .includes("origin")
  );
}

// The GitHub "open a PR" page for base...branch. Branch names keep their slash
// (agent/<task>) — GitHub's compare path takes them raw, not percent-encoded.
export function compareUrl(githubUrl: string, base: string, branch: string): string {
  return `${githubUrl}/compare/${base}...${branch}?expand=1`;
}

// Push the worktree's branch to origin (so it can be turned into a PR).
export async function pushWorktree(cwd: string): Promise<PushResult> {
  const repo = await repoRoot(cwd);
  if (!repo || !isManagedWorktree(repo, cwd)) return { ok: false, reason: "not-worktree" };
  const branch = await currentBranch(cwd);
  if (!branch) return { ok: false, reason: "no-branch" };
  if (!(await hasOrigin(cwd))) return { ok: false, reason: "no-remote" };
  const pushed = await run("git", ["push", "-u", "origin", branch], cwd);
  return pushed.ok ? { ok: true, branch } : { ok: false, reason: "push-failed", detail: pushed.stderr.trim().slice(0, DETAIL_LIMIT) };
}

// Push, then create a PR via gh — falling back to the GitHub compare URL when gh is
// absent/unauthed/errors. Returns the URL to open and which path produced it.
export async function createOrOpenPR(cwd: string): Promise<PrResult> {
  const pushed = await pushWorktree(cwd);
  if (!pushed.ok || !pushed.branch) return { ok: false, reason: pushed.reason, detail: pushed.detail };
  const branch = pushed.branch;
  const repo = await repoRoot(cwd);
  if (!repo) return { ok: false, reason: "not-worktree" };
  const base = await defaultBaseBranch(repo);

  const gh = await run("gh", ["pr", "create", "--base", base, "--head", branch, "--fill"], cwd);
  const ghUrl = gh.ok ? lastGhUrl(gh.stdout) : null;
  if (ghUrl) return { ok: true, url: ghUrl, via: "gh" };

  const githubUrl = await resolveGithubUrl(cwd);
  if (!githubUrl) return { ok: false, reason: "no-github", detail: gh.stderr.trim().slice(0, DETAIL_LIMIT) };
  return { ok: true, url: compareUrl(githubUrl, base, branch), via: "compare" };
}
