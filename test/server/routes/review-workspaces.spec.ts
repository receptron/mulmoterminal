// @vitest-environment node
// The reviewer MulmoTerminal starts (#3425): on the PR's head in a worktree of the repository's
// clone, as the author's own session, visible, and with codex's sandbox allowed the network.
import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { reviewWorkspaces, type ReviewWorkspaceDeps } from "../../../server/routes/review-workspaces.js";
import type { ReviewLoop } from "../../../server/routes/reviewLoop.js";
import type { SpawnIssueSession } from "../../../server/session/spawn/issue-session-spawn.js";

const AUTHOR = "0b7d2c1e-1111-4222-8333-944455556666";
const HEAD = "a".repeat(40);
const NEXT = "b".repeat(40);
// Built the way the code builds it, so the separator is the platform's (`\\` on Windows).
const WORKSPACE = path.join("/review", "owner-repo-pr7");
const SPEC = { repo: "owner/repo", pr: 7, head: HEAD, agent: "codex" as const, author: AUTHOR, seed: "Review pull request #7" };

function setup(overrides: Partial<ReviewWorkspaceDeps> = {}) {
  const gitCalls: [string, string][] = [];
  const present = new Set<string>();
  const spawn = vi.fn<SpawnIssueSession>(async (agent) => ({ sessionId: "rev-1", agent, seedRuns: true }));
  const recordSpawn = vi.fn<(child: string, parent: string) => void>();
  const markVisible = vi.fn();
  const deps: ReviewWorkspaceDeps = {
    cloneOf: async () => "/src/repo",
    root: () => "/review",
    worktree: {
      git: async (args, cwd) => {
        gitCalls.push([cwd, args.join(" ")]);
        if (args[0] === "worktree" && args[1] === "add") present.add(args[4] ?? "");
        if (args[0] === "worktree" && args[1] === "remove") present.delete(args[3] ?? "");
        return { ok: true, stdout: args[1] === "list" ? [...present].map((dir) => `worktree ${dir}`).join("\n") : "" };
      },
      exists: (dir) => present.has(dir),
      isSymlink: () => false,
      realpath: (dir) => dir,
    },
    spawn,
    recordSpawn,
    markVisible,
    ...overrides,
  };
  return { workspaces: reviewWorkspaces(deps), gitCalls, present, spawn, recordSpawn, markVisible };
}

const loopOn = (workspace: string | null): ReviewLoop => ({
  repo: "owner/repo",
  pr: 7,
  author: AUTHOR,
  reviewer: "rev-1",
  workspace,
  rounds: [],
  running: false,
});

describe("reviewWorkspaces.start", () => {
  it("checks the head out, then starts the agent there on the request, the author's and visible, with the network", async () => {
    const { workspaces, gitCalls, spawn, recordSpawn, markVisible } = setup();
    expect(await workspaces.start(SPEC)).toEqual({ session: "rev-1", workspace: WORKSPACE });
    expect(gitCalls.map(([, args]) => args)).toEqual(["fetch --quiet origin pull/7/head", `worktree add --quiet --detach ${WORKSPACE} ${HEAD}`]);
    expect(spawn).toHaveBeenCalledWith("codex", WORKSPACE, SPEC.seed, true, null, { networkAccess: true, neverAsk: true });
    expect(recordSpawn).toHaveBeenCalledWith("rev-1", AUTHOR);
    expect(markVisible).toHaveBeenCalledWith("rev-1", "codex");
  });

  it("starts nothing without a clone", async () => {
    const { workspaces, spawn } = setup({ cloneOf: async () => null });
    expect(await workspaces.start(SPEC)).toMatch(/no local clone of owner\/repo/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("starts nothing when the head cannot be checked out", async () => {
    const { workspaces, spawn } = setup({
      worktree: { git: async () => ({ ok: false, stdout: "" }), exists: () => false, isSymlink: () => false, realpath: (dir) => dir },
    });
    expect(await workspaces.start(SPEC)).toMatch(/could not fetch/);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("reviewWorkspaces.start, when the spawn fails", () => {
  it("removes the worktree it just made and says why, rather than throwing", async () => {
    const { workspaces, gitCalls, present } = setup({
      spawn: vi.fn<SpawnIssueSession>(async () => {
        throw new Error("tmux refused");
      }),
    });
    expect(await workspaces.start(SPEC)).toMatch(/could not start the reviewer: tmux refused/);
    expect(gitCalls.at(-1)).toEqual(["/src/repo", `worktree remove --force ${WORKSPACE}`]);
    expect(present.size).toBe(0);
  });
});

describe("reviewWorkspaces.move / drop", () => {
  it("moves the worktree it made to the next head, from inside it", async () => {
    const { workspaces, gitCalls } = setup();
    const started = await workspaces.start(SPEC);
    if (typeof started === "string") throw new Error(started);
    expect(await workspaces.move(loopOn(started.workspace), NEXT)).toBeNull();
    expect(gitCalls.at(-1)).toEqual([started.workspace, `checkout --quiet --force --detach ${NEXT}`]);
  });

  it("refuses to move or remove a directory it did not make", async () => {
    const { workspaces, gitCalls } = setup();
    expect(await workspaces.move(loopOn("/elsewhere"), NEXT)).toMatch(/not one this server made/);
    expect(await workspaces.move(loopOn(null), NEXT)).toMatch(/not one this server made/);
    await workspaces.drop(loopOn("/elsewhere"));
    await workspaces.drop(loopOn(null));
    expect(gitCalls).toEqual([]);
  });

  it("removes the worktree it made through the clone, once", async () => {
    const { workspaces, gitCalls, present } = setup();
    const started = await workspaces.start(SPEC);
    if (typeof started === "string") throw new Error(started);
    await workspaces.drop(loopOn(started.workspace));
    expect(gitCalls.at(-1)).toEqual(["/src/repo", `worktree remove --force ${started.workspace}`]);
    expect(present.has(started.workspace)).toBe(false);
    const before = gitCalls.length;
    await workspaces.drop(loopOn(started.workspace));
    expect(gitCalls).toHaveLength(before);
  });

  it("never throws from drop, whatever git does", async () => {
    const remove = vi.fn(async () => {
      throw new Error("git missing");
    });
    const { workspaces } = setup({
      worktree: {
        git: async (args) => (args[1] === "remove" ? remove() : { ok: true, stdout: `worktree ${WORKSPACE}` }),
        exists: () => true,
        isSymlink: () => false,
        realpath: (dir) => dir,
      },
    });
    const started = await workspaces.start(SPEC);
    if (typeof started === "string") throw new Error(started);
    await expect(workspaces.drop(loopOn(started.workspace))).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
