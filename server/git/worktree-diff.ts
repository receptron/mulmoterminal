// Read-only diff of a managed worktree against the branch it was forked from, so a
// cell can show how much the agent changed (ahead/dirty badge) and what changed
// (file list + patch). Mutations (push / PR) live elsewhere. All git calls reuse
// the shared runner and never throw — a non-worktree dir is just `isWorktree:false`.
import { git, repoRoot, defaultBaseBranch, isManagedWorktree } from "./worktrees.js";
import { dirtyCount } from "./dirty-count.js";
import { capPatch, parseNumstatLine } from "./git-parse.js";

export interface WorktreeFile {
  path: string;
  additions: number; // -1 for binary (git reports "-")
  deletions: number;
  status: "changed" | "untracked";
}

export interface WorktreeDiff {
  isWorktree: boolean;
  base: string | null;
  ahead: number; // commits on the worktree branch not on base
  dirty: number; // uncommitted entries (incl. untracked)
  files: WorktreeFile[];
  patch: string; // `git diff <base>` (tracked changes vs base), capped
  truncated: boolean;
}

const PATCH_LIMIT_CHARS = 200_000;
const EMPTY: WorktreeDiff = { isWorktree: false, base: null, ahead: 0, dirty: 0, files: [], patch: "", truncated: false };

const toCount = (s: string): number => {
  const n = parseInt(s.trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

async function aheadOf(cwd: string, base: string): Promise<number> {
  const res = await git(["rev-list", "--count", `${base}..HEAD`], cwd);
  return res.ok ? toCount(res.stdout) : 0;
}

// git escapes non-ASCII paths as C-quoted octal ("\346\227\245…") by default, which the
// UI would show as garbage. `-c core.quotePath=false` makes it emit raw UTF-8 instead, so
// a 日本語.txt reads as itself. Applied to every call whose output is a file PATH.
const QUOTE_PATH_OFF = ["-c", "core.quotePath=false"];

// A trailing `--` separates the revision from pathspecs, so `git diff <base>` isn't
// "ambiguous argument: both revision and filename" when the worktree holds a file whose
// name equals the base branch (e.g. a file literally called `main`).
const REV_END = "--";

// Tracked changes vs base, with +/- counts (numstat: "<add>\t<del>\t<path>", "-"
// for binary). Untracked files aren't in `git diff`, so add them from status.
async function changedFiles(cwd: string, base: string): Promise<WorktreeFile[]> {
  const tracked = await git([...QUOTE_PATH_OFF, "diff", "--numstat", base, REV_END], cwd);
  const files: WorktreeFile[] = tracked.ok ? tracked.stdout.split("\n").filter(Boolean).map(parseNumstat) : [];
  const untracked = await git([...QUOTE_PATH_OFF, "ls-files", "--others", "--exclude-standard"], cwd);
  const news = untracked.ok ? untracked.stdout.split("\n").filter(Boolean) : [];
  return [...files, ...news.map((path): WorktreeFile => ({ path, additions: 0, deletions: 0, status: "untracked" }))];
}

function parseNumstat(line: string): WorktreeFile {
  return { ...parseNumstatLine(line, toCount), status: "changed" };
}

async function diffPatch(cwd: string, base: string): Promise<{ patch: string; truncated: boolean }> {
  // Same quoting fix as changedFiles: the patch's own `diff --git a/… b/…` headers carry
  // the paths, so a non-ASCII filename would otherwise render as octal escapes here too.
  // Trailing `--` disambiguates the base revision from a same-named file (see REV_END).
  const res = await git([...QUOTE_PATH_OFF, "diff", base, REV_END], cwd);
  if (!res.ok) return { patch: "", truncated: false };
  const full = res.stdout;
  return capPatch(full, PATCH_LIMIT_CHARS);
}

export async function worktreeDiff(cwd: string): Promise<WorktreeDiff> {
  const repo = await repoRoot(cwd);
  if (!repo || !isManagedWorktree(repo, cwd)) return EMPTY;
  const base = await defaultBaseBranch(repo);
  const [ahead, dirty, files, patch] = await Promise.all([aheadOf(cwd, base), dirtyCount(cwd), changedFiles(cwd, base), diffPatch(cwd, base)]);
  return { isWorktree: true, base, ahead, dirty, files, patch: patch.patch, truncated: patch.truncated };
}
