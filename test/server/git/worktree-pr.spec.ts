import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorktree } from "../../../server/git/../../server/git/worktrees.js";
import { compareUrl, pushWorktree, createOrOpenPR } from "../../../server/git/../../server/git/worktree-pr.js";

describe("compareUrl", () => {
  it("builds the GitHub compare/open-PR url, keeping the branch slash raw", () => {
    expect(compareUrl("https://github.com/owner/repo", "main", "agent/fix-login")).toBe(
      "https://github.com/owner/repo/compare/main...agent/fix-login?expand=1",
    );
  });
});

describe("push / PR actions", () => {
  let repo: string;
  let home: string;
  let remote: string;
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
    home = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-pr-home-")));
    process.env.MULMOTERMINAL_HOME = home;
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-pr-repo-")));
    remote = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-pr-remote-")));
    if (!hasGit) return;
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
    execFileSync("git", ["init", "--bare", "-b", "main", remote], { stdio: "ignore" });
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
    rmSync(remote, { recursive: true, force: true });
  });

  it.skipIf(!hasGit)("pushes the worktree branch to origin", async () => {
    g(repo, "remote", "add", "origin", remote);
    const wt = await createWorktree(repo, "fix login");
    if (!wt) throw new Error("expected a worktree");
    writeFileSync(path.join(wt.path, "a.txt"), "x");
    g(wt.path, "add", "-A");
    g(wt.path, "commit", "-m", "work");

    const res = await pushWorktree(wt.path);
    expect(res).toEqual({ ok: true, branch: "agent/fix-login" });
    // the branch now exists on the bare remote
    const refs = execFileSync("git", ["-C", remote, "branch", "--list", "agent/fix-login"], { encoding: "utf8" }); // eslint-disable-line sonarjs/no-os-command-from-path
    expect(refs).toContain("agent/fix-login");
  });

  it.skipIf(!hasGit)("refuses to push when there is no origin remote", async () => {
    const wt = await createWorktree(repo, "no-remote");
    if (!wt) throw new Error("expected a worktree");
    expect(await pushWorktree(wt.path)).toEqual({ ok: false, reason: "no-remote" });
  });

  it.skipIf(!hasGit)("refuses a path that isn't a managed worktree", async () => {
    expect(await pushWorktree(repo)).toEqual({ ok: false, reason: "not-worktree" });
  });

  it.skipIf(!hasGit)("createOrOpenPR pushes, then reports no-github for a non-GitHub remote", async () => {
    g(repo, "remote", "add", "origin", remote); // a local bare remote, not github.com
    const wt = await createWorktree(repo, "feature");
    if (!wt) throw new Error("expected a worktree");
    writeFileSync(path.join(wt.path, "a.txt"), "x");
    g(wt.path, "add", "-A");
    g(wt.path, "commit", "-m", "work");

    const res = await createOrOpenPR(wt.path);
    // gh can't make a PR (no GitHub) and the remote isn't github.com → no compare url
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no-github");
    // but the push half still landed the branch on the remote
    const refs = execFileSync("git", ["-C", remote, "branch", "--list", "agent/feature"], { encoding: "utf8" }); // eslint-disable-line sonarjs/no-os-command-from-path
    expect(refs).toContain("agent/feature");
    // (the compare-url SUCCESS path can't be exercised locally — origin can't be
    // both a pushable bare repo and github.com — so compareUrl() is unit-tested
    // above and the gh→fallback wiring is covered by this no-github case.)
  });
});
