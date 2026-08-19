// @vitest-environment node
import { canSymlink } from "../../support/canSymlink.js";
import { makeTempDir } from "../../support/tempDir.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { reservedWorktreeEnv } from "../../../server/config/worktree-env.js";
import path from "node:path";
import { rmDirRetrying, GIT_TEST_TIMEOUT_MS } from "./wtTestUtil.js";
import {
  slugify,
  parseWorktreeList,
  worktreesRoot,
  isManagedWorktree,
  gitTopLevel,
  createWorktree,
  listWorktrees,
  isDirty,
  removeWorktree,
  git,
  branchStem,
  worktreeDirName,
  baseStartPoint,
  issueWorktree,
} from "../../../server/git/worktrees";
import { issueFromAnchoredBranch } from "../../../common/prPhase";

describe("slugify", () => {
  it("makes a filesystem-safe slug, with a fallback", () => {
    expect(slugify("  Fix Login Bug! ")).toBe("fix-login-bug");
    expect(slugify("Fix: ログイン bug")).toBe("fix-bug"); // non-ascii dropped
    expect(slugify("")).toBe("task");
    expect(slugify("***")).toBe("task");
    expect(slugify("a".repeat(80))).toHaveLength(40);
  });
});

describe("branchStem / worktreeDirName", () => {
  it("puts the issue number in the branch, and leaves an unanchored task as it was", () => {
    expect(branchStem("Anchor the worktree", 1171)).toBe("issue/1171-anchor-the-worktree");
    expect(branchStem("Fix Login")).toBe("agent/fix-login");
  });

  // The round trip is the whole point of the naming: what creation writes, the PR body reads back.
  it("round-trips through issueFromAnchoredBranch", () => {
    expect(issueFromAnchoredBranch(branchStem("whatever", 1171))).toBe(1171);
    expect(issueFromAnchoredBranch(branchStem("whatever"))).toBeNull();
  });

  // `worktree add` would create `<root>/issue/1026-x` without complaining, nesting a level below
  // the managed root — which nothing errors on and nothing shows.
  it.each([
    ["agent/fix-login", "fix-login"],
    ["issue/1171-anchor", "1171-anchor"],
    ["a/b/c", "b-c"],
    ["no-prefix", "no-prefix"],
  ])("keeps %s to a single path segment: %s", (branch, expected) => {
    expect(worktreeDirName(branch)).toBe(expected);
    expect(worktreeDirName(branch)).not.toContain("/");
  });
});

describe("parseWorktreeList", () => {
  it("parses porcelain blocks (path/head/branch, detached)", () => {
    const raw = ["worktree /repo", "HEAD aaa", "branch refs/heads/main", "", "worktree /repo/wt", "HEAD bbb", "detached", ""].join("\n");
    expect(parseWorktreeList(raw)).toEqual([
      { path: "/repo", head: "aaa", branch: "main" },
      { path: "/repo/wt", head: "bbb", branch: null },
    ]);
  });
});

describe("worktreesRoot / isManagedWorktree", () => {
  it("keys the root by basename + a stable hash and guards membership", () => {
    const root = worktreesRoot("/work/myapp");
    expect(path.basename(root)).toMatch(/^myapp-[0-9a-f]{8}$/);
    expect(worktreesRoot("/other/myapp")).not.toBe(root); // same basename, different path
    expect(isManagedWorktree("/work/myapp", path.join(root, "fix"))).toBe(true);
    expect(isManagedWorktree("/work/myapp", "/work/myapp")).toBe(false); // the main checkout
    expect(isManagedWorktree("/work/myapp", "/etc/passwd")).toBe(false);
  });
});

// Integration: a real temp git repo, with the managed root redirected to a temp dir.
describe("git worktree lifecycle", () => {
  let repo: string;
  let home: string;
  const hasGit = (() => {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
      execFileSync("git", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  // Creating a symlink needs privilege / Developer Mode on Windows; where it's denied
  // we can't build the escape fixture. The behaviour under test (containment survives a
  // symlink escape) only matters where symlinks exist, so skipping there loses nothing.

  beforeEach(async () => {
    // realpath: git resolves symlinks (macOS /tmp -> /private/var), and the engine
    // keys the managed root off git's toplevel, so the test dirs must match that.
    home = makeTempDir("mt-wt-home-");
    process.env.MULMOTERMINAL_HOME = home;
    repo = makeTempDir("mt-wt-repo-");
    if (!hasGit) return;
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
    const g = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
    g("init", "-b", "main");
    g("config", "user.email", "t@t.t");
    g("config", "user.name", "t");
    writeFileSync(path.join(repo, "README.md"), "hi");
    g("add", "-A");
    g("commit", "-m", "init");
    // The engine keys the managed root off git's toplevel string; adopt git's exact
    // form (forward slashes, 8.3 expanded on Windows) so hashes line up on any OS.
    repo = (await gitTopLevel(repo)) ?? repo;
  });
  afterEach(() => {
    delete process.env.MULMOTERMINAL_HOME;
    rmDirRetrying(home);
    rmDirRetrying(repo);
  });

  it.skipIf(!hasGit)(
    "creates, lists, detects dirty, and removes a worktree",
    async () => {
      expect(await gitTopLevel(repo)).toBe(repo);

      const wt = await createWorktree(repo, "Fix Login");
      if (!wt) throw new Error("expected a worktree");
      expect(wt.branch).toBe("agent/fix-login");
      expect(existsSync(wt.path)).toBe(true);
      expect(isManagedWorktree(repo, wt.path)).toBe(true);

      const list = await listWorktrees(repo);
      expect(list.map((w) => w.branch)).toEqual(["agent/fix-login"]); // excludes the main checkout

      expect(await isDirty(wt.path)).toBe(false);
      writeFileSync(path.join(wt.path, "new.txt"), "x");
      expect(await isDirty(wt.path)).toBe(true);

      // a dirty worktree is refused without force, then removed with force + branch
      expect(await removeWorktree(repo, wt.path)).toEqual({ ok: false, reason: "dirty" });
      expect(await removeWorktree(repo, wt.path, { force: true, deleteBranch: true })).toEqual({ ok: true });
      expect(existsSync(wt.path)).toBe(false);
      expect(await listWorktrees(repo)).toEqual([]);
      // Regression (#748): deleteBranch actually deleted the branch. This failed silently
      // when the branch lookup compared non-canonical paths and found no match.
      const branchList = await git(["branch", "--list", wt.branch], repo);
      expect(branchList.stdout.trim()).toBe("");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // #1317. A worktree used to start with no config at all: the project's colours, name, model and
  // grid rank all stopped at the main checkout. Written to the LOCAL override since #1436 — that
  // is the file a project gitignores, so this keeps working whether or not the shared config is
  // committed.
  it.skipIf(!hasGit)(
    "gives each new worktree the project's settings, a hue further round each time",
    async () => {
      writeFileSync(path.join(repo, ".gitignore"), ".mulmoterminal.local.json\n");
      const project = { name: "proj", headerColor: "#2d4ea9", headerTextColor: "#ffffff", orderPriority: 30, model: "qwen3:8b" };
      writeFileSync(path.join(repo, ".mulmoterminal.json"), JSON.stringify(project));
      await git(["add", ".gitignore", ".mulmoterminal.json"], repo);
      await git(["commit", "-m", "commit the shared config, ignore the local one"], repo);

      const first = await createWorktree(repo, "first");
      if (!first) throw new Error("expected a worktree");
      const config = (dir: string): unknown => JSON.parse(readFileSync(path.join(dir, ".mulmoterminal.local.json"), "utf8"));
      expect(config(first.path)).toEqual({ name: "proj", model: "qwen3:8b", headerColor: "#2d35a9", headerTextColor: "#ffffff", orderPriority: 31 });
      // The file we just wrote must not read as a change. isDirty is what removeWorktree
      // consults, so a worktree dirtied by our own write could no longer be cleaned up.
      expect(await isDirty(first.path)).toBe(false);

      const second = await createWorktree(repo, "second");
      if (!second) throw new Error("expected a second worktree");
      expect(config(second.path)).toMatchObject({ headerColor: "#3e2da9" });

      // The failure the check-ignore guard exists to prevent, pinned end to end: a worktree
      // holding a config we wrote is still removable WITHOUT force. Asserting isDirty alone
      // would miss it — `git worktree remove` has its own idea of clean.
      expect(await removeWorktree(repo, second.path, { deleteBranch: true })).toEqual({ ok: true });
      expect(existsSync(second.path)).toBe(false);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // The guard is on the file we WRITE. A project that ignores neither would gain an untracked
  // file, and `isDirty` — which removeWorktree consults — would then refuse to clean the worktree
  // up over a change we made ourselves.
  it.skipIf(!hasGit)(
    "writes no config where git would not ignore the local file",
    async () => {
      writeFileSync(path.join(repo, ".mulmoterminal.json"), JSON.stringify({ headerColor: "#2d4ea9" }));
      const wt = await createWorktree(repo, "unignored");
      if (!wt) throw new Error("expected a worktree");
      expect(existsSync(path.join(wt.path, ".mulmoterminal.local.json"))).toBe(false);
      expect(await isDirty(wt.path)).toBe(false);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // Backward compatibility, and the reason the shared file is still a fallback: the setup this
  // feature SHIPPED with told people to gitignore `.mulmoterminal.json`, and those repositories
  // exist. Switching the target outright would have turned their worktrees grey with nothing said.
  it.skipIf(!hasGit)(
    "still tints a worktree in a repository set up the old way (only the shared file ignored)",
    async () => {
      writeFileSync(path.join(repo, ".gitignore"), ".mulmoterminal.json\n");
      writeFileSync(path.join(repo, ".mulmoterminal.json"), JSON.stringify({ name: "proj", headerColor: "#2d4ea9", orderPriority: 30 }));
      await git(["add", ".gitignore"], repo);
      await git(["commit", "-m", "ignore the shared config, the pre-#1436 way"], repo);

      const wt = await createWorktree(repo, "legacy");
      if (!wt) throw new Error("expected a worktree");
      // Written to the SHARED file here, since that is the one this repository ignores.
      expect(existsSync(path.join(wt.path, ".mulmoterminal.local.json"))).toBe(false);
      expect(JSON.parse(readFileSync(path.join(wt.path, ".mulmoterminal.json"), "utf8"))).toMatchObject({
        name: "proj",
        headerColor: "#2d35a9",
        orderPriority: 31,
      });
      expect(await isDirty(wt.path)).toBe(false);
      expect(await removeWorktree(repo, wt.path, { deleteBranch: true })).toEqual({ ok: true });
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // The regression #1436 exists for: committing the shared config used to switch inheritance off,
  // because the guard asked about that file rather than the one being written.
  it.skipIf(!hasGit)(
    "still tints a worktree whose project COMMITS its shared config",
    async () => {
      writeFileSync(path.join(repo, ".gitignore"), ".mulmoterminal.local.json\n");
      writeFileSync(path.join(repo, ".mulmoterminal.json"), JSON.stringify({ name: "proj", headerColor: "#2d4ea9", orderPriority: 30 }));
      await git(["add", ".gitignore", ".mulmoterminal.json"], repo);
      await git(["commit", "-m", "commit the shared config"], repo);

      const wt = await createWorktree(repo, "tinted");
      if (!wt) throw new Error("expected a worktree");
      const local: unknown = JSON.parse(readFileSync(path.join(wt.path, ".mulmoterminal.local.json"), "utf8"));
      expect(local).toMatchObject({ name: "proj", headerColor: "#2d35a9", orderPriority: 31 });
      // The committed file came along with the checkout and is untouched.
      expect(JSON.parse(readFileSync(path.join(wt.path, ".mulmoterminal.json"), "utf8"))).toMatchObject({ headerColor: "#2d4ea9" });
      expect(await isDirty(wt.path)).toBe(false);
      expect(await removeWorktree(repo, wt.path, { deleteBranch: true })).toEqual({ ok: true });
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // Reserved AT CREATION, not on the first terminal socket (#1367): a worktree started from an
  // issue has its agent spawned directly (routes/issue-work-routes.ts), so a reservation that only
  // happened in the ws handlers would miss the one flow this feature is most for.
  it.skipIf(!hasGit)(
    "reserves the project's per-tree environment for a worktree it creates",
    async () => {
      writeFileSync(path.join(repo, ".gitignore"), ".mulmoterminal.json\n");
      writeFileSync(path.join(repo, ".mulmoterminal.json"), JSON.stringify({ worktreeEnv: { PORT: { kind: "port", base: 3000 } } }));
      // Committed, or the worktree's checkout has no .gitignore and the config is never adopted
      // — which would make this pass for the wrong reason on the day the reservation regressed.
      await git(["add", ".gitignore"], repo);
      await git(["commit", "-m", "ignore the local config"], repo);

      const wt = await createWorktree(repo, "needs a port");
      if (!wt) throw new Error("expected a worktree");
      // The SYNC read — what a spawner sees, with nothing else having run in between.
      expect(reservedWorktreeEnv(wt.path)).toEqual({ PORT: "3010" });
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it.skipIf(!hasGit)(
    "anchors the branch to an issue, and still puts the worktree directly under the managed root",
    async () => {
      const wt = await createWorktree(repo, "Anchor the worktree", 1171);
      if (!wt) throw new Error("expected a worktree");
      expect(wt.branch).toBe("issue/1171-anchor-the-worktree");
      // The directory is what breaks silently if the branch prefix leaks into the path.
      expect(path.dirname(wt.path)).toBe(worktreesRoot(repo));
      expect(existsSync(wt.path)).toBe(true);
      expect((await listWorktrees(repo)).map((w) => w.branch)).toEqual(["issue/1171-anchor-the-worktree"]);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // The bug this closes: several clones of one repo sit side by side and only the one being
  // worked in gets pulled, so forking from LOCAL main starts the work on however old that clone
  // is. Here the remote-tracking ref is ahead of local main, and the new worktree must be at the
  // remote's commit — the old code produced the local one and nothing said so. This is asserted
  // for BOTH an issue-anchored worktree and a plain type-a-task-name one: they used to differ
  // here (only the issue-started path paid for a fresh base), which was its own source of the
  // same bug — a plus-button worktree forking from a stale local main, and its eventual PR
  // conflicting with whatever had already landed. Both now always fork from the fresher of the
  // two, local or remote.
  it.skipIf(!hasGit)(
    "forks from origin/<base> rather than the local branch when the two differ",
    async () => {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
      const g = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
      const rev = (ref: string) =>
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
        execFileSync("git", ["-C", repo, "rev-parse", ref], { encoding: "utf8" }).trim();

      const local = rev("HEAD");
      writeFileSync(path.join(repo, "remote-only.txt"), "landed on the mainline while this clone sat still");
      g("add", "-A");
      g("commit", "-m", "remote work");
      const remote = rev("HEAD");
      g("update-ref", "refs/remotes/origin/main", remote);
      g("reset", "--hard", local); // the clone is now behind what origin has

      expect(await baseStartPoint(repo, "main")).toBe("origin/main");
      const wt = await createWorktree(repo, "start point", 1171);
      if (!wt) throw new Error("expected a worktree");
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
      expect(execFileSync("git", ["-C", wt.path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(remote);
      expect(existsSync(path.join(wt.path, "remote-only.txt"))).toBe(true);

      const unanchored = await createWorktree(repo, "unanchored");
      if (!unanchored) throw new Error("expected a worktree");
      expect(existsSync(path.join(unanchored.path, "remote-only.txt"))).toBe(true);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // A repo with no remote at all — the fork point has to fall back to the local branch, or the
  // launcher stops working offline / on a repo that was never pushed.
  it.skipIf(!hasGit)(
    "falls back to the local branch when there is no remote-tracking ref",
    async () => {
      expect(await baseStartPoint(repo, "main")).toBe("main");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // The other half of the rule: preferring the remote unconditionally would drop commits that
  // were made locally and not pushed yet. When local already contains the remote it is a
  // superset, so nothing is lost by staying on it.
  it.skipIf(!hasGit)(
    "keeps the local branch when it is ahead of origin",
    async () => {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
      const g = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
      const head = () => execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

      g("update-ref", "refs/remotes/origin/main", head()); // origin is level with local...
      writeFileSync(path.join(repo, "unpushed.txt"), "committed here, never pushed");
      g("add", "-A");
      g("commit", "-m", "local work"); // ...and now local is one ahead

      expect(await baseStartPoint(repo, "main")).toBe("main");
      const wt = await createWorktree(repo, "keeps local work", 1171);
      if (!wt) throw new Error("expected a worktree");
      expect(existsSync(path.join(wt.path, "unpushed.txt"))).toBe(true);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // Diverged is not "ahead": local holds a commit origin doesn't, but it is also MISSING one.
  // The mainline wins, because a branch forked from the local side would be built on a commit
  // the repository never took.
  it.skipIf(!hasGit)(
    "takes origin when local and origin have diverged",
    async () => {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
      const g = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
      const head = () => execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

      const shared = head();
      writeFileSync(path.join(repo, "theirs.txt"), "x");
      g("add", "-A");
      g("commit", "-m", "theirs");
      g("update-ref", "refs/remotes/origin/main", head());
      g("reset", "--hard", shared);
      writeFileSync(path.join(repo, "ours.txt"), "y");
      g("add", "-A");
      g("commit", "-m", "ours"); // same parent as theirs — the two have diverged

      expect(await baseStartPoint(repo, "main")).toBe("origin/main");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // Two prefixes, one directory namespace: the directory drops the prefix segment, so these two
  // branch names both want `<root>/1171-x`. `worktree add` would fail the whole create.
  it.skipIf(!hasGit)(
    "does not let an anchored branch collide with an unanchored one over the same directory",
    async () => {
      const unanchored = await createWorktree(repo, "1171 x");
      const anchored = await createWorktree(repo, "x", 1171);
      if (!unanchored || !anchored) throw new Error("expected two worktrees");
      expect(unanchored.branch).toBe("agent/1171-x");
      expect(anchored.branch).toBe("issue/1171-x-2"); // suffixed because the directory was taken
      expect(anchored.path).not.toBe(unanchored.path);
      expect(existsSync(anchored.path)).toBe(true);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // #1219: whether this issue already has a tree here. The suffix case is the one that matters —
  // those are exactly the second worktrees this bug produced, and they must be found and reopened
  // rather than joined by a third.
  it.skipIf(!hasGit)(
    "finds the worktree an issue already has, suffix and all",
    async () => {
      expect(await issueWorktree(repo, 1171)).toBeNull();

      await createWorktree(repo, "1171 x"); // agent/1171-x — takes the directory name
      const anchored = await createWorktree(repo, "x", 1171); // issue/1171-x-2
      if (!anchored) throw new Error("expected a worktree");

      const found = await issueWorktree(repo, 1171);
      expect(found?.branch).toBe("issue/1171-x-2");
      expect(found?.path).toBe(anchored.path);
      // The unanchored `agent/1171-x` sitting beside it names no issue, so it is not an answer
      // here — its number came from a task the user typed, not from this app anchoring anything.
      expect(await issueWorktree(repo, 1172)).toBeNull();
    },
    GIT_TEST_TIMEOUT_MS,
  );

  // git keeps reporting a worktree whose directory was deleted by hand until somebody prunes.
  // The caller STARTS A SESSION in what this returns, so a stale entry would put an agent in a
  // directory that is not there — where cutting a fresh tree is what should happen.
  it.skipIf(!hasGit)(
    "does not answer with a worktree whose directory has been deleted",
    async () => {
      const wt = await createWorktree(repo, "gone", 1171);
      if (!wt) throw new Error("expected a worktree");
      expect(await issueWorktree(repo, 1171)).not.toBeNull();

      rmDirRetrying(wt.path);
      expect(await issueWorktree(repo, 1171)).toBeNull();
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it.skipIf(!hasGit)(
    "forks a unique branch on a name clash",
    async () => {
      const a = await createWorktree(repo, "task");
      const b = await createWorktree(repo, "task");
      if (!a || !b) throw new Error("expected two worktrees");
      expect(a.branch).toBe("agent/task");
      expect(b.branch).toBe("agent/task-2");
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it.skipIf(!hasGit)(
    "allocates distinct branches for CONCURRENT creates of the same task (no TOCTOU collision)",
    async () => {
      const isWt = (r: { path: string; branch: string } | null): r is { path: string; branch: string } => r !== null;
      const results = (
        await Promise.all([createWorktree(repo, "race"), createWorktree(repo, "race"), createWorktree(repo, "race"), createWorktree(repo, "race")])
      ).filter(isWt);
      expect(results).toHaveLength(4); // none failed with a branch-already-exists 500
      expect(new Set(results.map((r) => r.branch)).size).toBe(4); // all distinct
      expect(new Set(results.map((r) => r.path)).size).toBe(4);
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it.skipIf(!hasGit)(
    "refuses to remove a path outside the managed root",
    async () => {
      expect(await removeWorktree(repo, repo)).toEqual({ ok: false, reason: "not-managed" });
      expect(await removeWorktree(repo, path.join(home, "outside-managed"))).toEqual({ ok: false, reason: "not-managed" });
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it.skipIf(!hasGit || !canSymlink)(
    "rejects a symlink under the managed root that escapes it (no string-prefix bypass)",
    async () => {
      const wt = await createWorktree(repo, "real"); // creates the managed root dir
      if (!wt) throw new Error("expected a worktree");
      const root = worktreesRoot(repo);
      const outside = makeTempDir("mt-wt-outside-");
      const link = path.join(root, "escape");
      symlinkSync(outside, link); // <root>/escape -> /outside (canonicalizes out of the root)
      try {
        expect(isManagedWorktree(repo, link)).toBe(false);
        expect(isManagedWorktree(repo, path.join(link, "wt"))).toBe(false); // symlinked ancestor, absent leaf
        expect(await removeWorktree(repo, link)).toEqual({ ok: false, reason: "not-managed" });
      } finally {
        rmDirRetrying(outside);
      }
    },
    GIT_TEST_TIMEOUT_MS,
  );

  it("gitTopLevel returns null for a non-repo dir", async () => {
    const plain = makeTempDir("mt-wt-plain-");
    expect(await gitTopLevel(plain)).toBeNull();
    rmDirRetrying(plain);
  });
});
