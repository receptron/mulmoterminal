// Per-agent git worktree isolation: each cell can run claude in its own throwaway
// worktree (a separate working tree sharing the repo's single .git), so several
// agents work the same repo without clobbering each other. Worktrees live under a
// managed root (~/.mulmoterminal/worktrees/<repo>-<hash>/<task>) so the repo dir
// stays clean and we only ever remove paths WE created. The pure helpers (slug /
// parse / paths) are split out for unit tests; the rest shell out to git.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { isStrictlyWithin } from "../infra/path-within.js";
import { mulmoterminalHome } from "../infra/mulmoterminal-home.js";
import { canonicalPath } from "../infra/canonical-path.js";
import { ensureWorktreeEnv } from "../config/worktree-env.js";
import { splitLines } from "../infra/split-lines.js";
import { DIR_CONFIG_FILE, DIR_LOCAL_CONFIG_FILE } from "../config/dir-config.js";
import { writeInheritedDirConfig } from "../config/worktree-dir-config.js";
import { ISSUE_BRANCH_PREFIX, issueFromAnchoredBranch } from "../../common/prPhase.js";

// realpathSync.native, not the JS one: on Windows only the native call expands an
// 8.3 short component (C:\Users\RUNNER~1 → …\runneradmin) to the long form that
// `git worktree list` reports, so the two agree in the containment check below.
const realpath = realpathSync.native;

// Read lazily so MULMOTERMINAL_HOME can redirect the managed root (used by tests to
// avoid touching the real home dir; defaults to ~/.mulmoterminal). Resolved to its
// realpath so it matches the realpaths `git worktree list` reports (e.g. macOS
// /tmp -> /private/tmp), which the isManagedWorktree filter relies on.
function worktreesBase(): string {
  const base = mulmoterminalHome();
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

// Whether `p` is inside the managed root for `repoToplevel` — the guard that stops
// a delete request from touching anything we didn't create. Both sides are
// canonicalized so a symlink under the root can't escape it (string-prefix alone
// would let `<root>/link -> /outside` slip through).
export function isManagedWorktree(repoToplevel: string, p: string): boolean {
  // STRICTLY within: the root holds worktrees but is not one, so a delete aimed at the
  // root itself must not pass this guard.
  return isStrictlyWithin(canonicalPath(worktreesRoot(repoToplevel)), canonicalPath(p));
}

// Parse `git worktree list --porcelain` into entries (blocks split by blank lines).
export function parseWorktreeList(porcelain: string): { path: string; head: string; branch: string | null }[] {
  const out: { path: string; head: string; branch: string | null }[] = [];
  let cur: { path: string; head: string; branch: string | null } | null = null;
  for (const line of splitLines(porcelain)) {
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
export function git(args: string[], cwd?: string, timeoutMs: number = GIT_TIMEOUT_MS): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' is a standard tool from PATH in this local dev server; all inputs go through argv (no shell)
    const child = spawn("git", cwd ? ["-C", cwd, ...args] : args, { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
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

// The BASE BRANCH a worktree's work targets: origin's default (HEAD), else main / master if
// present, else the repo's current branch. A branch NAME — it is what a PR's `--base` and the
// compare URL take, so it must stay local-style (`main`, not `origin/main`). Where the new
// branch actually forks from is `baseStartPoint` below, which is a different question.
export async function defaultBaseBranch(repo: string): Promise<string> {
  const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo);
  if (head.ok && head.stdout.trim()) return head.stdout.trim().replace(/^origin\//, "");
  for (const b of ["main", "master"]) {
    if ((await git(["rev-parse", "--verify", "--quiet", b], repo)).ok) return b;
  }
  const cur = await git(["rev-parse", "--abbrev-ref", "HEAD"], repo);
  return cur.ok && cur.stdout.trim() ? cur.stdout.trim() : "main";
}

// Shorter than GIT_TIMEOUT_MS: this one runs while the user waits on a worktree, and a network
// that isn't answering must cost seconds before we fall back to what is already fetched — not
// the two minutes a local `worktree add` is allowed to take.
const FETCH_TIMEOUT_MS = 30_000;

// Best-effort refresh of the remote-tracking refs before forking a branch. Failure is normal and
// silent: a repo with no origin, an offline laptop, a private remote with no agent loaded — none
// of those should stop a worktree from being created.
async function fetchOrigin(repo: string): Promise<void> {
  await git(["fetch", "origin"], repo, FETCH_TIMEOUT_MS);
}

// The commit an ISSUE-STARTED branch forks FROM. Several clones of one repo run side by side here
// and only the one being worked in gets pulled, so forking from local `main` silently starts the
// work on however old that clone is — and nothing about the result says so.
//
// But "always take the remote" would be a different silent loss: a local base holding commits
// that were never pushed would have them dropped from under the new branch. So the local one
// wins whenever it ALREADY CONTAINS the remote — then it is a superset and nothing is lost. Only
// when it is behind or diverged does the mainline win. A repo with no origin has no remote ref
// and keeps its local branch.
export async function baseStartPoint(repo: string, base: string): Promise<string> {
  const remote = `origin/${base}`;
  if (!(await git(["rev-parse", "--verify", "--quiet", remote], repo)).ok) return base;
  const localHasRemote = await git(["merge-base", "--is-ancestor", remote, base], repo);
  return localHasRemote.ok ? base : remote;
}

// Refresh the remote, then resolve the fork point against it.
const freshStartPoint = async (repo: string): Promise<string> => {
  await fetchOrigin(repo);
  return baseStartPoint(repo, await defaultBaseBranch(repo));
};

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

/** The managed worktree this repo already has for `issue`, or null.
 *
 *  Read through `issueFromAnchoredBranch` — the same reader the PR body's `Fixes #N` and the work
 *  chip use — so "which issue is this branch for" has ONE answer in the app rather than a second
 *  regex that can drift from it. A uniqueness suffix does not change the number, so an
 *  `issue/12-x-2` created before this existed is still found and reopened.
 *
 *  A worktree whose DIRECTORY is gone does not count. `git worktree list` keeps reporting one that
 *  was deleted by hand until somebody prunes, and the caller starts a session in what this returns
 *  — so trusting the list alone would spawn an agent in a directory that no longer exists, where
 *  before it would simply have cut a new tree. */
export async function issueWorktree(repoDir: string, issue: number): Promise<WorktreeInfo | null> {
  const found = (await listWorktrees(repoDir)).find((w) => issueFromAnchoredBranch(w.branch) === issue && existsSync(w.path));
  return found ?? null;
}

// Whether a worktree has uncommitted changes (so we don't delete it silently).
export async function isDirty(worktreePath: string): Promise<boolean> {
  const res = await git(["status", "--porcelain"], worktreePath);
  return res.ok && res.stdout.trim().length > 0;
}

// What a new worktree's branch is called before the uniqueness suffix. An issue-started one puts
// the number IN the name (#1171), which is what lets the PR body, the work-item chip and the
// issue comment all learn which issue this branch belongs to without being told a second time.
export function branchStem(task: string, issue?: number | undefined): string {
  const slug = slugify(task);
  return issue ? `${ISSUE_BRANCH_PREFIX}${issue}-${slug}` : `agent/${slug}`;
}

// The managed worktree's DIRECTORY name: the branch with its prefix segment dropped, joined so
// the result is always ONE path segment. It has to be — `worktree add` would happily create
// `<root>/issue/1026-x`, nesting a level below the root with no error anywhere.
export function worktreeDirName(branch: string): string {
  const segments = branch.split("/").filter(Boolean);
  return segments.length > 1 ? segments.slice(1).join("-") : branch;
}

// A branch name for `stem` whose branch AND whose worktree directory are both free (<stem>, then
// -2, -3…). Both, because the directory drops the prefix segment: `agent/1171-x` and
// `issue/1171-x` are two branches that want the one directory, and `worktree add` would fail the
// whole create with an unexplained error. While every branch was `agent/…` a free branch implied
// a free directory, so this only became possible with the second prefix.
const MAX_BRANCH_SUFFIX = 99;
async function uniqueBranch(repo: string, stem: string, root: string): Promise<string> {
  for (let n = 1; n <= MAX_BRANCH_SUFFIX; n++) {
    const name = n === 1 ? stem : `${stem}-${n}`;
    const branchTaken = (await git(["rev-parse", "--verify", "--quiet", name], repo)).ok;
    if (!branchTaken && !existsSync(path.join(root, worktreeDirName(name)))) return name;
  }
  return `${stem}-${Date.now()}`;
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

// Carry the project's look and settings into a worktree that has just been created (#1317):
// same name, theme, model and grid rank, with the chrome colours nudged around the hue wheel so
// each tree is its own shade of the project. The parent is the MAIN checkout, so cutting a
// worktree from another worktree still measures the gradient from the project itself.
//
// Only where git would IGNORE the file we are about to write. A worktree whose `git status` gains
// an untracked file is not merely untidy: `isDirty` reads that same status, so removeWorktree
// would go on refusing to clean up a worktree whose only change we wrote ourselves.
//
// Preferably the LOCAL override (#1436), which this repository — and any project that adopts the
// convention — gitignores. Checking the shared file instead used to mean that committing it
// silently switched this whole feature off.
//
// The shared file stays as a FALLBACK, because the setup this feature shipped with told people to
// gitignore THAT one, and those repositories still exist. Switching the target outright would have
// turned their worktrees grey with nothing said — the same silent breakage, aimed the other way.
// A repository that COMMITS the shared file is not caught by the fallback: git reports a tracked
// file as not-ignored, so it is skipped and only the local override can be written.
//
// Best effort throughout — a worktree without its parent's colours is a worktree that works.
async function inheritableConfigFile(worktreeDir: string): Promise<string | null> {
  for (const name of [DIR_LOCAL_CONFIG_FILE, DIR_CONFIG_FILE]) {
    if ((await git(["check-ignore", "--quiet", "--", name], worktreeDir)).ok) return name;
  }
  return null;
}

async function adoptParentDirConfig(repo: string, worktreeDir: string): Promise<void> {
  try {
    const name = await inheritableConfigFile(worktreeDir);
    if (!name) return;
    // Counted AFTER the add, so it includes the new tree: the first worktree of a repo is index
    // 1 and therefore already one hue step away from the parent, not identical to it.
    writeInheritedDirConfig(repo, worktreeDir, (await listWorktrees(repo)).length, name);
  } catch {
    // ignored
  }
}

// Create a fresh worktree + branch for `task`, forked from the repo's base branch. Pass `issue`
// to anchor the branch to a GitHub issue (`issue/<N>-<slug>`). Either way the fork point is the
// base AS THE REMOTE HAS IT (see freshStartPoint): several clones of one repo sit side by side
// here and only the one you happen to be in gets pulled, so forking from local main starts the
// work on however old that clone is — and a PR opened from it conflicts with whatever landed on
// the mainline since. `fetchOrigin` is a best-effort 30s-capped round trip, silent and harmless
// offline or with no remote (baseStartPoint then falls back to the local branch). Returns the
// worktree path + branch, or null if `repoDir` isn't a git repo / the worktree add fails.
export async function createWorktree(repoDir: string, task: string, issue?: number | undefined): Promise<{ path: string; branch: string } | null> {
  const repo = await repoRoot(repoDir);
  if (!repo) return null;
  const stem = branchStem(task, issue);
  const root = worktreesRoot(repo);
  const start = await freshStartPoint(repo);
  return serializeCreate(async () => {
    const branch = await uniqueBranch(repo, stem, root);
    const dir = path.join(root, worktreeDirName(branch));
    const res = await git(["worktree", "add", "-b", branch, dir, start], repo);
    if (!res.ok) return null;
    await adoptParentDirConfig(repo, dir);
    // AFTER the config is adopted — the declaration this reads is the one just written — and here
    // rather than only in the ws handlers, because a worktree started FROM AN ISSUE has its agent
    // spawned directly (routes/issue-work-routes.ts), never through a terminal socket. Reserving
    // only there would leave the one flow this feature is most for without its port.
    await ensureWorktreeEnv(dir);
    return { path: dir, branch };
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
