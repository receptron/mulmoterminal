import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { gitStatus } from "./git-status.js";

describe("gitStatus", () => {
  let repo: string;
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
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-gitstatus-")));
    if (!hasGit) return;
    g(repo, "init", "-b", "main");
    g(repo, "config", "user.email", "t@t.t");
    g(repo, "config", "user.name", "t");
    writeFileSync(path.join(repo, "README.md"), "hi\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-m", "init");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("reports repo:false for a non-git dir", async () => {
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-nogit-")));
    const s = await gitStatus(outside);
    expect(s.repo).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });

  it.skipIf(!hasGit)("reports branch and a clean tree", async () => {
    const s = await gitStatus(repo);
    expect(s.repo).toBe(true);
    expect(s.branch).toBe("main");
    expect(s.detached).toBe(false);
    expect(s.dirty).toBe(0);
    expect(s.upstream).toBe(false); // no remote in the test repo
  });

  it.skipIf(!hasGit)("shows the branch on an unborn branch (git init, no commit yet)", async () => {
    const fresh = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-unborn-")));
    g(fresh, "init", "-b", "main"); // no commit — unborn HEAD
    const s = await gitStatus(fresh);
    expect(s.repo).toBe(true);
    expect(s.branch).toBe("main");
    expect(s.detached).toBe(false);
    rmSync(fresh, { recursive: true, force: true });
  });

  it.skipIf(!hasGit)("counts dirty entries (modified + untracked)", async () => {
    writeFileSync(path.join(repo, "README.md"), "changed\n"); // modify tracked
    writeFileSync(path.join(repo, "new.txt"), "new\n"); // untracked
    const s = await gitStatus(repo);
    expect(s.dirty).toBe(2);
  });

  it.skipIf(!hasGit)("reports detached HEAD", async () => {
    writeFileSync(path.join(repo, "b.txt"), "b\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-m", "second");
    g(repo, "checkout", "--detach", "HEAD");
    const s = await gitStatus(repo);
    expect(s.detached).toBe(true);
    expect(s.branch).toBeNull();
  });

  it.skipIf(!hasGit)("reports ahead vs a local upstream", async () => {
    // A second clone acting as the "remote" so HEAD has an upstream to be ahead of.
    const remote = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-remote-")));
    g(repo, "clone", "--bare", repo, remote);
    g(repo, "remote", "add", "origin", remote);
    g(repo, "push", "-u", "origin", "main");
    writeFileSync(path.join(repo, "c.txt"), "c\n");
    g(repo, "add", "-A");
    g(repo, "commit", "-m", "ahead by one");
    const s = await gitStatus(repo);
    expect(s.upstream).toBe(true);
    expect(s.ahead).toBe(1);
    expect(s.behind).toBe(0);
    rmSync(remote, { recursive: true, force: true });
  });
});
