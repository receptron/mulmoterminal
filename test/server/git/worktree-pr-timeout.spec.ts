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
import { pushWorktree, NETWORK_MUTATION_TIMEOUT_MS } from "../../../server/git/worktree-pr.js";

describe("pushWorktree timeout (#754)", () => {
  beforeEach(() => vi.mocked(spawnCollect).mockClear());

  it("gives git push a generous timeout, not the 30s default that kills slow pushes", async () => {
    const res = await pushWorktree("/repo/wt");
    expect(res.ok).toBe(true);
    const pushCall = vi.mocked(spawnCollect).mock.calls.find((c) => c[0] === "git" && c[1][0] === "push");
    expect(pushCall).toBeDefined();
    expect(pushCall?.[2].timeoutMs).toBe(NETWORK_MUTATION_TIMEOUT_MS);
    expect(NETWORK_MUTATION_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});
