// Read-only git status for a terminal's working dir, so the header can always show
// branch / dirty / ahead·behind without the user running `git status`. Reuses the
// shared git runner and never throws — a non-repo dir is just `repo:false`.
import { git, gitTopLevel } from "./worktrees.js";

export interface GitStatus {
  repo: boolean;
  branch: string | null; // null when detached or non-repo
  detached: boolean;
  dirty: number; // uncommitted entries (incl. untracked)
  ahead: number; // commits on HEAD not on the upstream
  behind: number; // commits on the upstream not on HEAD
  upstream: boolean; // HEAD has a tracking branch (ahead/behind are meaningful)
}

const NOT_REPO: GitStatus = { repo: false, branch: null, detached: false, dirty: 0, ahead: 0, behind: 0, upstream: false };

const toCount = (s: string): number => {
  const n = parseInt(s.trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

// The current branch, or detached when HEAD isn't on a branch (git prints "HEAD").
async function currentBranch(cwd: string): Promise<{ branch: string | null; detached: boolean }> {
  const res = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const name = res.ok ? res.stdout.trim() : "";
  if (!name || name === "HEAD") return { branch: null, detached: name === "HEAD" };
  return { branch: name, detached: false };
}

async function dirtyCount(cwd: string): Promise<number> {
  const res = await git(["status", "--porcelain"], cwd);
  return res.ok ? res.stdout.split("\n").filter((l) => l.trim()).length : 0;
}

// ahead/behind vs the tracking branch. `--left-right @{upstream}...HEAD` prints
// "<behind>\t<ahead>"; a missing upstream makes the command fail → upstream:false.
async function aheadBehind(cwd: string): Promise<{ ahead: number; behind: number; upstream: boolean }> {
  const res = await git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], cwd);
  if (!res.ok) return { ahead: 0, behind: 0, upstream: false };
  const [behind, ahead] = res.stdout.trim().split(/\s+/);
  return { ahead: toCount(ahead ?? ""), behind: toCount(behind ?? ""), upstream: true };
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const top = await gitTopLevel(cwd);
  if (!top) return NOT_REPO;
  const [head, dirty, ab] = await Promise.all([currentBranch(cwd), dirtyCount(cwd), aheadBehind(cwd)]);
  return { repo: true, branch: head.branch, detached: head.detached, dirty, ahead: ab.ahead, behind: ab.behind, upstream: ab.upstream };
}
