// Per-agent git worktree isolation: each cell can run claude in its own throwaway
// worktree (a separate working tree sharing the repo's single .git), so several
// agents work the same repo without clobbering each other. Worktrees live under a
// managed root (~/.mulmoterminal/worktrees/<repo>-<hash>/<task>) so the repo dir
// stays clean and we only ever remove paths WE created. The pure helpers (slug /
// parse / paths) are split out for unit tests; the rest shell out to git.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// realpathSync.native, not the JS one: on Windows only the native call expands an
// 8.3 short component (C:\Users\RUNNER~1 → …\runneradmin) to the long form that
// `git worktree list` reports, so the two agree in the containment check below.
const realpath = realpathSync.native;

// Read lazily so MULMOTERMINAL_HOME can redirect the managed root (used by tests to
// avoid touching the real home dir; defaults to ~/.mulmoterminal). Resolved to its
// realpath so it matches the realpaths `git worktree list` reports (e.g. macOS
// /tmp -> /private/tmp), which the isManagedWorktree filter relies on.
function worktreesBase(): string {
  const base = process.env.MULMOTERMINAL_HOME || path.join(os.homedir(), ".mulmoterminal");
  try {
    return path.join(realpath(base), "worktrees");
  } catch {
    return path.join(base, "worktrees"); // doesn't exist yet — first run
  }
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
  task: string; // the managed worktree's directory name (its task slug)
}

// A filesystem-safe, readable slug for a branch/dir segment. Empty/garbage input
// falls back to "task" so we never produce an empty branch or path component.
export function slugify(task: string): string {
  const slug = task
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") // single edge dash only: the line above collapsed runs
    .slice(0, 40);
  return slug || "task";
}

// The managed worktree root for a repo. Keyed by basename + a short hash of the
// absolute path so two repos with the same basename don't collide.
export function worktreesRoot(repoToplevel: string): string {
  const hash = createHash("sha1").update(repoToplevel).digest("hex").slice(0, 8);
  return path.join(worktreesBase(), `${path.basename(repoToplevel)}-${hash}`);
}

// Canonicalize a path by realpath-resolving its deepest EXISTING ancestor and
// re-attaching the missing leaf segments. So a symlink anywhere along the path
// (even when the leaf itself doesn't exist) is resolved before containment checks.
function canonicalPath(p: string): string {
  const resolved = path.resolve(p);
  const missing: string[] = [];
  let cur = resolved;
  for (;;) {
    try {
      const real = realpath(cur);
      return missing.length ? path.join(real, ...missing) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return resolved; // reached the fs root, nothing resolved
      missing.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

// Whether `p` is inside the managed root for `repoToplevel` — the guard that stops
// a delete request from touching anything we didn't create. Both sides are
// canonicalized so a symlink under the root can't escape it (string-prefix alone
// would let `<root>/link -> /outside` slip through).
export function isManagedWorktree(repoToplevel: string, p: string): boolean {
  const root = canonicalPath(worktreesRoot(repoToplevel)) + path.sep;
  return canonicalPath(p).startsWith(root);
}

// Parse `git worktree list --porcelain` into entries (blocks split by blank lines).
export function parseWorktreeList(porcelain: string): { path: string; head: string; branch: string | null }[] {
  const out: { path: string; head: string; branch: string | null }[] = [];
  let cur: { path: string; head: string; branch: string | null } | null = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) cur = { path: line.slice(9).trim(), head: "", branch: null };
    else if (line.startsWith("HEAD ") && cur) cur.head = line.slice(5).trim();
    else if (line.startsWith("branch ") && cur)
      cur.branch = line
        .slice(7)
        .trim()
        .replace(/^refs\/heads\//, "");
    else if (line.trim() === "" && cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Kill a git call that never finishes (a broken hook waiting on input, a stuck lfs
// smudge) so it can't pin a request forever. Generous: a real `worktree add` that
// checks out a large repo is slow but not infinite.
const GIT_TIMEOUT_MS = 120_000;

// Run git with argv (no shell) in `cwd`; resolve { ok, stdout } — never reject, so
// a missing git / non-repo dir is just `ok:false` and the caller falls back.
export function git(args: string[], cwd?: string): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' is a standard tool from PATH in this local dev server; all inputs go through argv (no shell)
    const child = spawn("git", cwd ? ["-C", cwd, ...args] : args, { stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT_MS });
    // Collect bytes and decode ONCE: a chunk can split a multibyte UTF-8 character, and
    // per-chunk toString() would turn a non-ASCII path/message into replacement chars.
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    // stderr is not returned, but it MUST still be drained: git blocks on a full stderr
    // pipe (a repo that prints thousands of lfs/hook warnings easily exceeds the 64KB
    // buffer), so an unread pipe deadlocks the whole call. Discard the bytes, keep reading.
    child.stderr.on("data", () => {});
    child.on("error", () => resolve({ ok: false, stdout: "" }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout: Buffer.concat(chunks).toString("utf8") }));
  });
}

// The current working tree's root, or null if `dir` isn't inside a git work tree.
export async function gitTopLevel(dir: string): Promise<string | null> {
  const res = await git(["rev-parse", "--show-toplevel"], dir);
  return res.ok && res.stdout.trim() ? res.stdout.trim() : null;
}

// The MAIN repo's root (the first entry of `worktree list`), so the managed root is
// keyed off the repo even when `dir` is itself one of our worktrees. null if not a
// git repo.
export async function repoRoot(dir: string): Promise<string | null> {
  const res = await git(["worktree", "list", "--porcelain"], dir);
  if (!res.ok) return null;
  return parseWorktreeList(res.stdout)[0]?.path ?? null;
}

// The branch new worktrees should fork from: origin's default (HEAD), else main /
// master if present, else the repo's current branch.
export async function defaultBaseBranch(repo: string): Promise<string> {
  const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo);
  if (head.ok && head.stdout.trim()) return head.stdout.trim().replace(/^origin\//, "");
  for (const b of ["main", "master"]) {
    if ((await git(["rev-parse", "--verify", "--quiet", b], repo)).ok) return b;
  }
  const cur = await git(["rev-parse", "--abbrev-ref", "HEAD"], repo);
  return cur.ok && cur.stdout.trim() ? cur.stdout.trim() : "main";
}

// The managed worktrees for a repo (excludes the main checkout and any worktrees
// outside our root), each tagged with its task = directory name.
export async function listWorktrees(repoDir: string): Promise<WorktreeInfo[]> {
  const repo = await repoRoot(repoDir);
  if (!repo) return [];
  const res = await git(["worktree", "list", "--porcelain"], repo);
  if (!res.ok) return [];
  return (
    parseWorktreeList(res.stdout)
      .filter((w) => isManagedWorktree(repo, w.path))
      // git reports forward-slash paths even on Windows; normalize to the OS separator so
      // a listed worktree's path matches what createWorktree (path.join) returned for it.
      .map((w) => ({ path: path.normalize(w.path), branch: w.branch, head: w.head, task: path.basename(w.path) }))
  );
}

// Whether a worktree has uncommitted changes (so we don't delete it silently).
export async function isDirty(worktreePath: string): Promise<boolean> {
  const res = await git(["status", "--porcelain"], worktreePath);
  return res.ok && res.stdout.trim().length > 0;
}

// A branch name for `task` that isn't already taken (agent/<slug>, then -2, -3…).
const MAX_BRANCH_SUFFIX = 99;
async function uniqueBranch(repo: string, slug: string): Promise<string> {
  for (let n = 1; n <= MAX_BRANCH_SUFFIX; n++) {
    const name = n === 1 ? `agent/${slug}` : `agent/${slug}-${n}`;
    if (!(await git(["rev-parse", "--verify", "--quiet", name], repo)).ok) return name;
  }
  return `agent/${slug}-${Date.now()}`;
}

// Serialize worktree creation process-wide so the uniqueBranch → `worktree add`
// sequence is atomic. Otherwise two concurrent creates for the same task can both
// pick `agent/<slug>` (TOCTOU) and one add fails, and our parallel adds would also
// contend on git's index lock. Runs each task after the prior settles (ok or not).
let createQueue: Promise<unknown> = Promise.resolve();
function serializeCreate<T>(task: () => Promise<T>): Promise<T> {
  const run = createQueue.then(task, task);
  createQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Create a fresh worktree + branch for `task`, forked from the repo's base branch.
// Returns the worktree path + branch, or null if `repoDir` isn't a git repo / the
// worktree add fails.
export async function createWorktree(repoDir: string, task: string): Promise<{ path: string; branch: string } | null> {
  const repo = await repoRoot(repoDir);
  if (!repo) return null;
  const slug = slugify(task);
  const base = await defaultBaseBranch(repo);
  return serializeCreate(async () => {
    const branch = await uniqueBranch(repo, slug);
    const dir = path.join(worktreesRoot(repo), branch.replace(/^agent\//, ""));
    const res = await git(["worktree", "add", "-b", branch, dir, base], repo);
    return res.ok ? { path: dir, branch } : null;
  });
}

// Remove a managed worktree (and prune), optionally deleting its branch. Refuses a
// path outside the managed root, or a dirty worktree unless `force`. Returns the
// outcome so the UI can surface "has uncommitted changes — confirm".
export async function removeWorktree(
  repoDir: string,
  worktreePath: string,
  opts: { force?: boolean; deleteBranch?: boolean } = {},
): Promise<{ ok: boolean; reason?: "not-managed" | "dirty" | "failed" }> {
  const repo = await repoRoot(repoDir);
  if (!repo || !isManagedWorktree(repo, worktreePath)) return { ok: false, reason: "not-managed" };
  if (!opts.force && (await isDirty(worktreePath))) return { ok: false, reason: "dirty" };

  // Match on CANONICAL paths, not path.resolve vs the listed path: git reports realpaths
  // (e.g. macOS /tmp → /private/tmp), so a plain string compare misses the entry when the
  // caller's path isn't already realpath-resolved — and a missed match silently skips the
  // branch deletion below (the worktree goes but its branch lingers).
  const target = canonicalPath(worktreePath);
  const branch = (await listWorktrees(repo)).find((w) => canonicalPath(w.path) === target)?.branch ?? null;
  const removed = await git(["worktree", "remove", ...(opts.force ? ["--force"] : []), worktreePath], repo);
  if (!removed.ok) return { ok: false, reason: "failed" };
  await git(["worktree", "prune"], repo);
  if (opts.deleteBranch && branch) await git(["branch", "-D", branch], repo);
  return { ok: true };
}
