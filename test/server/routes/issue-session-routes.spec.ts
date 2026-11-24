// @vitest-environment node
// startIssueSession (#3413): what must not happen is an implementer past the limit, two for one issue,
// one in a clone the server did not resolve, or one the caller cannot address afterwards.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Express } from "express";
import { implementerSpawn, mountIssueSessionRoutes, type IssueSessionRouteDeps } from "../../../server/routes/issue-session-routes.js";
import type { IssueSession } from "../../../server/routes/issueSessions.js";
import type { SpawnedSession, StartIssueWorkResult } from "../../../server/git/issue-work.js";
import { SESSION_HEADER } from "../../../server/backends/files/presentPathRoot.js";

const PARENT = "0b7d2c1e-1111-4222-8333-944455556666";
const BODY = { repo: "owner/repo", issue: 7 };

interface Req {
  body: unknown;
  get(name: string): string | undefined;
}
type Handler = (req: Req, res: { json: (body: { message?: string; jsonData?: { chatId: string } }) => void }) => unknown;

let sessions: Map<string, IssueSession>;
let running: Set<string>;
let limit: number;
let clone: string | null;
let work: (spawnSeeded: (cwd: string, seed: string) => Promise<SpawnedSession>) => Promise<StartIssueWorkResult & Partial<SpawnedSession>>;
let nextId: number;
const STARTED_AT_MS = 1_790_000_000_000;
const spawn = vi.fn<IssueSessionRouteDeps["spawn"]>();
const recordSpawn = vi.fn<IssueSessionRouteDeps["recordSpawn"]>();
const markVisible = vi.fn<IssueSessionRouteDeps["markVisible"]>();
const startWork = vi.fn<IssueSessionRouteDeps["startWork"]>();

function route(): Handler {
  let handler: Handler | undefined;
  const app = { post: (_path: string, h: Handler) => (handler = h) } as unknown as Express;
  mountIssueSessionRoutes(app, {
    sessions,
    isRunning: (session) => running.has(session),
    isGitHub: (repo) => !repo.startsWith("gitlab.com/"),
    limit: () => limit,
    cloneOf: async () => clone,
    now: () => STARTED_AT_MS,
    startWork,
    spawn,
    recordSpawn,
    markVisible,
  });
  if (!handler) throw new Error("route not mounted");
  return handler;
}

const req = (body: unknown, caller: string | null = PARENT): Req => ({
  body,
  get: (name) => (name.toLowerCase() === SESSION_HEADER ? (caller ?? undefined) : undefined),
});

async function call(handler: Handler, request: Req): Promise<{ message: string; chatId: string | undefined }> {
  let answer: { message: string; chatId: string | undefined } = { message: "", chatId: undefined };
  await handler(request, { json: (body) => (answer = { message: body.message ?? "", chatId: body.jsonData?.chatId }) });
  return answer;
}

/** A fresh worktree per issue, seeded through the spawn the route hands over. */
const freshWorktree = async (spawnSeeded: (cwd: string, seed: string) => Promise<SpawnedSession>) => {
  const spawned = await spawnSeeded("/wt/7", "the issue text");
  return { ok: true, outcome: "created" as const, worktree: "/wt/7", branch: "issue/7-thing", ...spawned };
};

beforeEach(() => {
  sessions = new Map();
  running = new Set([PARENT]);
  limit = 2;
  clone = "/repo";
  nextId = 0;
  work = freshWorktree;
  spawn.mockReset();
  spawn.mockImplementation(async (agent) => {
    nextId += 1;
    const sessionId = `s-${nextId}`;
    running.add(sessionId);
    return { sessionId, agent, seedRuns: true };
  });
  recordSpawn.mockReset();
  markVisible.mockReset();
  startWork.mockReset();
  startWork.mockImplementation(async (_repo, _issue, _dir, spawnSeeded) => work(spawnSeeded));
});

describe("startIssueSession", () => {
  it("starts the implementer in the issue's worktree with the skill seed, visible and addressable by the caller", async () => {
    const answer = await call(route(), req({ ...BODY, agent: "codex" }));
    expect(answer.chatId).toBe("s-1");
    expect(answer.message).toContain("1 of 2");
    expect(startWork).toHaveBeenCalledWith("owner/repo", 7, "/repo", expect.any(Function));
    const [agent, cwd, seed] = spawn.mock.calls[0] ?? [];
    expect([agent, cwd]).toEqual(["codex", "/wt/7"]);
    expect(seed).toContain("mulmoterminal-issue-to-merge");
    expect(seed).not.toBe("the issue text");
    expect(recordSpawn).toHaveBeenCalledWith("s-1", PARENT);
    expect(markVisible).toHaveBeenCalledWith("s-1", "codex");
    expect(sessions.get("s-1")).toMatchObject({ parent: PARENT, repo: "owner/repo", issue: 7, branch: "issue/7-thing", worktree: "/wt/7" });
    expect(sessions.get("s-1")?.startedAtMs).toBe(STARTED_AT_MS);
  });

  it("refuses a call without a caller, or with a bad request, before touching anything", async () => {
    expect((await call(route(), req(BODY, null))).message).toContain("only from a MulmoTerminal terminal");
    expect((await call(route(), req({ ...BODY, agent: "grok" }))).message).toContain("agent");
    expect(startWork).not.toHaveBeenCalled();
  });

  it("refuses at the limit, and starts again once an implementer stops running", async () => {
    const handler = route();
    await call(handler, req({ ...BODY, issue: 7 }));
    await call(handler, req({ ...BODY, issue: 8 }));
    expect((await call(handler, req({ ...BODY, issue: 9 }))).message).toContain("maxIssueSessions");
    expect(spawn).toHaveBeenCalledTimes(2);
    running.delete("s-1");
    expect((await call(handler, req({ ...BODY, issue: 9 }))).chatId).toBe("s-3");
  });

  it("reads the limit at each start", async () => {
    const handler = route();
    limit = 1;
    await call(handler, req({ ...BODY, issue: 7 }));
    expect((await call(handler, req({ ...BODY, issue: 8 }))).message).toContain("(1)");
    limit = 2;
    expect((await call(handler, req({ ...BODY, issue: 8 }))).chatId).toBe("s-2");
  });

  // The place is claimed before the clone lookup and the worktree, so two that arrive together cannot both pass.
  it("counts starts still in flight against the limit", async () => {
    limit = 1;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    work = async (spawnSeeded) => {
      await gate;
      return freshWorktree(spawnSeeded);
    };
    const handler = route();
    const first = call(handler, req({ ...BODY, issue: 7 }));
    expect((await call(handler, req({ ...BODY, issue: 8 }))).message).toContain("maxIssueSessions");
    release();
    expect((await first).chatId).toBe("s-1");
  });

  it("gives the place back when a start fails", async () => {
    limit = 1;
    const handler = route();
    work = async () => ({ ok: false, reason: "worktree-failed", detail: "not a git repo" });
    expect((await call(handler, req(BODY))).message).toContain("worktree-failed (not a git repo)");
    startWork.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    expect((await call(handler, req(BODY))).message).toContain("boom");
    work = freshWorktree;
    expect((await call(handler, req(BODY))).chatId).toBe("s-1");
  });

  it("refuses a second implementer for an issue one is still working on", async () => {
    const handler = route();
    await call(handler, req(BODY));
    expect((await call(handler, req(BODY))).message).toContain("already being worked on by session s-1");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("refuses a repository that is not on GitHub", async () => {
    expect((await call(route(), req({ repo: "gitlab.com/group/project", issue: 7 }))).message).toContain("not a GitHub repository");
    expect(startWork).not.toHaveBeenCalled();
  });

  it("refuses a repository with no clone here", async () => {
    clone = null;
    expect((await call(route(), req(BODY))).message).toContain("no clone configured");
    expect(startWork).not.toHaveBeenCalled();
  });

  // That session was not started with the review tools, and its input box is the user's.
  it("refuses a worktree whose session is already there, and records nothing", async () => {
    work = async () => ({ ok: true, outcome: "resumed", sessionId: "user-session", agent: "claude", seedRuns: false, worktree: "/wt/7" });
    expect((await call(route(), req(BODY))).message).toContain("already has session user-session");
    expect(sessions.size).toBe(0);
    expect(recordSpawn).not.toHaveBeenCalled();
    expect(markVisible).not.toHaveBeenCalled();
  });
});

// The wiring app-routes uses: without `allTools` the implementer is a project cell, and the review
// loop's tools never reach it.
describe("implementerSpawn", () => {
  it("runs the seed at once, on the default login, with every GUI tool", async () => {
    const spawnIssueSession = vi.fn(async () => ({ sessionId: "s-1", agent: "codex" as const, seedRuns: true }));
    await implementerSpawn(spawnIssueSession)("codex", "/wt/7", "the seed");
    expect(spawnIssueSession).toHaveBeenCalledWith("codex", "/wt/7", "the seed", true, null, { allTools: true });
  });
});
