// Outward-facing worktree actions (the "取り込み" half): push the worktree's branch
// and open/create a PR. PR creation prefers `gh pr create`; when gh is missing or
// unauthed it falls back to opening the GitHub compare URL in the browser. Guarded
// upstream by origin checks; here every command is argv-only (no shell).
import { spawn } from "node:child_process";
import { repoRoot, defaultBaseBranch, isManagedWorktree, git } from "./worktrees.js";
import { resolveGithubUrl } from "./gitRemote.js";

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

interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// Like worktrees.ts' git(), but captures stderr too (push/gh errors land there) and
// runs an arbitrary local tool (git / gh) — both fixed names from PATH, argv only.
function run(cmd: "git" | "gh", args: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", () => resolve({ ok: false, stdout: "", stderr: "spawn failed" }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
  });
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

// The last http(s) line of gh's output — `gh pr create` prints the PR URL last.
function lastUrl(stdout: string): string | null {
  const urls = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http"));
  return urls.length ? urls[urls.length - 1] : null;
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
  const ghUrl = gh.ok ? lastUrl(gh.stdout) : null;
  if (ghUrl) return { ok: true, url: ghUrl, via: "gh" };

  const githubUrl = await resolveGithubUrl(cwd);
  if (!githubUrl) return { ok: false, reason: "no-github", detail: gh.stderr.trim().slice(0, DETAIL_LIMIT) };
  return { ok: true, url: compareUrl(githubUrl, base, branch), via: "compare" };
}
