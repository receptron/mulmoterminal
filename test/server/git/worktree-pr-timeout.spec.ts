// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression for #754 codex review: the shared spawnCollect default (30s, tuned for quick
// gh reads) also governed `git push`, so a slow push on a large repo/remote was killed and
// mis-reported as push-failed. The push path must opt into a generous timeout. Mock both
// dependencies so pushWorktree's argv choices are observable without a real remote.
vi.mock("../../../server/git/spawn-collect.js", () => ({
  spawnCollect: vi.fn(async () => ({ ok: true, stdout: "", stderr: "" })),
}));
vi.mock("../../../server/git/worktrees.js", () => ({
  git: vi.fn(async (args: string[]) => {
    if (args[0] === "rev-parse") return { ok: true, stdout: "feature\n" }; // currentBranch
    if (args[0] === "remote") return { ok: true, stdout: "origin\n" }; // hasOrigin
    return { ok: true, stdout: "" };
  }),
  repoRoot: vi.fn(async () => "/repo"),
  isManagedWorktree: vi.fn(() => true),
  defaultBaseBranch: vi.fn(async () => "main"),
}));

import { spawnCollect } from "../../../server/git/spawn-collect.js";
import { pushWorktree, createOrOpenPR, NETWORK_MUTATION_TIMEOUT_MS } from "../../../server/git/worktree-pr.js";

describe("pushWorktree timeout (#754)", () => {
  beforeEach(() => vi.mocked(spawnCollect).mockReset());

  it("gives git push a generous timeout, not the 30s default that kills slow pushes", async () => {
    vi.mocked(spawnCollect).mockResolvedValue({ ok: true, stdout: "", stderr: "" });
    const res = await pushWorktree("/repo/wt");
    expect(res.ok).toBe(true);
    const pushCall = vi.mocked(spawnCollect).mock.calls.find((c) => c[0] === "git" && c[1][0] === "push");
    expect(pushCall).toBeDefined();
    expect(pushCall?.[2].timeoutMs).toBe(NETWORK_MUTATION_TIMEOUT_MS);
    expect(NETWORK_MUTATION_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("createOrOpenPR opens an existing PR (#748)", () => {
  beforeEach(() => vi.mocked(spawnCollect).mockReset());

  // Regression (#748): when a PR for the branch already exists, `gh pr create` fails and the
  // button used to fall back to the "open a new PR" compare page. It must return the EXISTING
  // PR's url instead.
  it("returns the existing PR url when gh pr create fails because one exists", async () => {
    vi.mocked(spawnCollect).mockImplementation(async (bin: string, args: string[]) => {
      if (bin === "git" && args[0] === "push") return { ok: true, stdout: "", stderr: "" };
      if (bin === "gh" && args[0] === "pr" && args[1] === "create") return { ok: false, stdout: "", stderr: "a pull request for branch already exists" };
      if (bin === "gh" && args[0] === "pr" && args[1] === "list") return { ok: true, stdout: '[{"url":"https://github.com/o/r/pull/42"}]', stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    });
    const res = await createOrOpenPR("/repo/wt");
    expect(res).toEqual({ ok: true, url: "https://github.com/o/r/pull/42", via: "gh" });
    // Regression (#762 Codex review): the lookup must NOT pass `--repo` — `run(..., cwd)` runs
    // gh inside the worktree so it infers the repo, and `--repo` only accepts an OWNER/REPO
    // slug (repoRoot(cwd) is a filesystem path, which would always error and defeat the lookup).
    const listCall = vi.mocked(spawnCollect).mock.calls.find((c) => c[0] === "gh" && c[1][1] === "list");
    expect(listCall?.[1]).not.toContain("--repo");
    expect(listCall?.[1]).toEqual(["pr", "list", "--head", "feature", "--state", "open", "--json", "url", "--limit", "1"]);
  });

  it("still returns a freshly created PR url via gh", async () => {
    vi.mocked(spawnCollect).mockImplementation(async (bin: string, args: string[]) => {
      if (bin === "git" && args[0] === "push") return { ok: true, stdout: "", stderr: "" };
      if (bin === "gh" && args[0] === "pr" && args[1] === "create") return { ok: true, stdout: "https://github.com/o/r/pull/7\n", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    });
    const res = await createOrOpenPR("/repo/wt");
    expect(res).toEqual({ ok: true, url: "https://github.com/o/r/pull/7", via: "gh" });
  });
});
