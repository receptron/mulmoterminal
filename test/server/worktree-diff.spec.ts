import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorktree } from "../../server/worktrees.js";
import { worktreeDiff } from "../../server/worktree-diff.js";

describe("worktreeDiff", () => {
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

  const g = (dir: string, ...a: string[]) =>
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
    execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });

  beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-diff-home-")));
    process.env.MULMOTERMINAL_HOME = home;
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-diff-repo-")));
    if (!hasGit) return;
    g(repo, "init", "-b", "main");
    g(repo, "config", "user.email", "t@t.t");
    g(repo, "config", "user.name", "t");
    writeFileSync(path.join(repo, "README.md"), "hi\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-m", "init");
  });
  afterEach(() => {
    delete process.env.MULMOTERMINAL_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("returns isWorktree:false for a non-worktree dir (the main repo)", async () => {
    const d = await worktreeDiff(repo);
    expect(d.isWorktree).toBe(false);
    expect(d).toMatchObject({ base: null, ahead: 0, dirty: 0, files: [], patch: "" });
  });

  it.skipIf(!hasGit)("reports ahead/dirty, changed + untracked files, and a patch vs base", async () => {
    const wt = await createWorktree(repo, "feature");
    if (!wt) throw new Error("expected a worktree");

    // one commit ahead of base: edit a tracked file and commit it
    writeFileSync(path.join(wt.path, "README.md"), "hi\nfrom the worktree\n");
    g(wt.path, "commit", "-am", "edit readme");
    // plus uncommitted work: a tracked edit and a brand-new untracked file
    writeFileSync(path.join(wt.path, "README.md"), "hi\nfrom the worktree\nuncommitted\n");
    writeFileSync(path.join(wt.path, "new.txt"), "added\n");

    const d = await worktreeDiff(wt.path);
    expect(d.isWorktree).toBe(true);
    expect(d.base).toBe("main");
    expect(d.ahead).toBe(1); // one commit not on main
    expect(d.dirty).toBe(2); // README (modified) + new.txt (untracked)

    const readme = d.files.find((f) => f.path === "README.md");
    expect(readme).toMatchObject({ status: "changed" });
    expect(readme?.additions).toBeGreaterThan(0);
    expect(d.files.find((f) => f.path === "new.txt")).toMatchObject({ status: "untracked", additions: 0, deletions: 0 });

    expect(d.patch).toContain("README.md"); // unified diff vs base
    expect(d.patch).toContain("from the worktree");
    expect(d.truncated).toBe(false);
  });

  it.skipIf(!hasGit)("reports zero ahead/dirty for a freshly-created (clean) worktree", async () => {
    const wt = await createWorktree(repo, "clean");
    if (!wt) throw new Error("expected a worktree");
    const d = await worktreeDiff(wt.path);
    expect(d).toMatchObject({ isWorktree: true, base: "main", ahead: 0, dirty: 0, files: [], patch: "" });
  });
});
