import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorktree } from "../../../server/git/worktrees.js";
import { worktreeDiff } from "../../../server/git/worktree-diff.js";

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

  // Regression (#743): git C-quotes non-ASCII paths ("\346\227\245…") by default, so the
  // changed-file list and the patch showed octal garbage for a Japanese filename. The fix
  // passes -c core.quotePath=false; here the real git output must carry the raw name.
  it.skipIf(!hasGit)("returns non-ASCII filenames raw, not C-quoted/octal-escaped", async () => {
    const wt = await createWorktree(repo, "unicode");
    if (!wt) throw new Error("expected a worktree");
    // a committed tracked change with a Japanese name (numstat + patch paths)
    writeFileSync(path.join(wt.path, "日本語.txt"), "本文\n");
    g(wt.path, "add", "-A");
    g(wt.path, "commit", "-m", "add japanese tracked file");
    // and an untracked one (ls-files path)
    writeFileSync(path.join(wt.path, "メモ.txt"), "memo\n");

    const d = await worktreeDiff(wt.path);
    const tracked = d.files.find((f) => f.status === "changed");
    const untracked = d.files.find((f) => f.status === "untracked");
    expect(tracked?.path).toBe("日本語.txt");
    expect(untracked?.path).toBe("メモ.txt");
    // no octal escapes / surrounding quotes leaked through
    expect(d.files.some((f) => f.path.includes("\\"))).toBe(false);
    expect(d.patch).toContain("日本語.txt");
    expect(d.patch).not.toContain("\\346");
  });

  // Regression (#748): `git diff main` is "ambiguous argument: both revision and filename"
  // when the worktree holds a file literally named after the base branch. The `--` separator
  // disambiguates it, so the diff still reports the file instead of erroring to empty.
  it.skipIf(!hasGit)("diffs cleanly when a file is named after the base branch", async () => {
    const wt = await createWorktree(repo, "ambiguous");
    if (!wt) throw new Error("expected a worktree");
    writeFileSync(path.join(wt.path, "main"), "a file whose name equals the base branch\n");
    g(wt.path, "add", "-A");
    g(wt.path, "commit", "-m", "add a file named main");

    const d = await worktreeDiff(wt.path);
    expect(d.isWorktree).toBe(true);
    expect(d.files.find((f) => f.path === "main")).toMatchObject({ status: "changed" });
    expect(d.patch).toContain("main");
  });
});
