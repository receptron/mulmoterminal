import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, realpathSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { slugify, parseWorktreeList, worktreesRoot, isManagedWorktree, gitTopLevel, createWorktree, listWorktrees, isDirty, removeWorktree } from "../../server/worktrees";

describe("slugify", () => {
  it("makes a filesystem-safe slug, with a fallback", () => {
    expect(slugify("  Fix Login Bug! ")).toBe("fix-login-bug");
    expect(slugify("Fix: ログイン bug")).toBe("fix-bug"); // non-ascii dropped
    expect(slugify("")).toBe("task");
    expect(slugify("***")).toBe("task");
    expect(slugify("a".repeat(80))).toHaveLength(40);
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

  beforeEach(() => {
    // realpath: git resolves symlinks (macOS /tmp -> /private/var), and the engine
    // keys the managed root off git's toplevel, so the test dirs must match that.
    home = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-wt-home-")));
    process.env.MULMOTERMINAL_HOME = home;
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-wt-repo-")));
    if (!hasGit) return;
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
    const g = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
    g("init", "-b", "main");
    g("config", "user.email", "t@t.t");
    g("config", "user.name", "t");
    writeFileSync(path.join(repo, "README.md"), "hi");
    g("add", "-A");
    g("commit", "-m", "init");
  });
  afterEach(() => {
    delete process.env.MULMOTERMINAL_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it.skipIf(!hasGit)("creates, lists, detects dirty, and removes a worktree", async () => {
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
  });

  it.skipIf(!hasGit)("forks a unique branch on a name clash", async () => {
    const a = await createWorktree(repo, "task");
    const b = await createWorktree(repo, "task");
    if (!a || !b) throw new Error("expected two worktrees");
    expect(a.branch).toBe("agent/task");
    expect(b.branch).toBe("agent/task-2");
  });

  it.skipIf(!hasGit)("allocates distinct branches for CONCURRENT creates of the same task (no TOCTOU collision)", async () => {
    const isWt = (r: { path: string; branch: string } | null): r is { path: string; branch: string } => r !== null;
    const results = (
      await Promise.all([createWorktree(repo, "race"), createWorktree(repo, "race"), createWorktree(repo, "race"), createWorktree(repo, "race")])
    ).filter(isWt);
    expect(results).toHaveLength(4); // none failed with a branch-already-exists 500
    expect(new Set(results.map((r) => r.branch)).size).toBe(4); // all distinct
    expect(new Set(results.map((r) => r.path)).size).toBe(4);
  });

  it.skipIf(!hasGit)("refuses to remove a path outside the managed root", async () => {
    expect(await removeWorktree(repo, repo)).toEqual({ ok: false, reason: "not-managed" });
    expect(await removeWorktree(repo, path.join(home, "outside-managed"))).toEqual({ ok: false, reason: "not-managed" });
  });

  it.skipIf(!hasGit)("rejects a symlink under the managed root that escapes it (no string-prefix bypass)", async () => {
    const wt = await createWorktree(repo, "real"); // creates the managed root dir
    if (!wt) throw new Error("expected a worktree");
    const root = worktreesRoot(repo);
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-wt-outside-")));
    const link = path.join(root, "escape");
    symlinkSync(outside, link); // <root>/escape -> /outside (canonicalizes out of the root)
    try {
      expect(isManagedWorktree(repo, link)).toBe(false);
      expect(isManagedWorktree(repo, path.join(link, "wt"))).toBe(false); // symlinked ancestor, absent leaf
      expect(await removeWorktree(repo, link)).toEqual({ ok: false, reason: "not-managed" });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("gitTopLevel returns null for a non-repo dir", async () => {
    const plain = mkdtempSync(path.join(tmpdir(), "mt-wt-plain-"));
    expect(await gitTopLevel(plain)).toBeNull();
    rmSync(plain, { recursive: true, force: true });
  });
});
