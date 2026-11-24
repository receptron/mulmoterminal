// @vitest-environment node
// closeIssueSession (#3428): what must not happen is a session closing an implementer it did not start,
// a still-working one closed without force, another implementer's reviewer closed, or a worktree
// removed while its cell is still open.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Express } from "express";
import { closeImplementer, mountIssueSessionCloseRoute, type IssueSessionCloseDeps } from "../../../server/routes/issue-session-close.js";
import type { IssueSession } from "../../../server/routes/issueSessions.js";
import type { ReviewLoop } from "../../../server/routes/reviewLoop.js";
import { SESSION_HEADER } from "../../../server/backends/files/presentPathRoot.js";

const PARENT = "0b7d2c1e-1111-4222-8333-944455556666";
const IMPLEMENTER = "1c8e3d2f-2222-4333-8444-a55566667777";
const OTHER = "2d9f4e3a-3333-4444-8555-b66677778888";

const entry = (over: Partial<IssueSession> = {}): IssueSession => ({
  session: IMPLEMENTER,
  parent: PARENT,
  repo: "owner/repo",
  issue: 7,
  agent: "claude",
  worktree: "/wt/7",
  branch: "issue/7-thing",
  finished: "merged",
  blockedTold: false,
  prUnreadable: 0,
  ...over,
});

const loop = (pr: number, author: string, reviewer: string): ReviewLoop => ({
  repo: "owner/repo",
  pr,
  author,
  reviewer,
  workspace: null,
  rounds: [],
  running: false,
});

let sessions: Map<string, IssueSession>;
let loops: Map<string, ReviewLoop>;
let calls: string[];
let stillOpen: Set<string>;
const removeWorktree = vi.fn<IssueSessionCloseDeps["removeWorktree"]>();
const dropWorkspace = vi.fn<IssueSessionCloseDeps["dropWorkspace"]>();

function deps(): IssueSessionCloseDeps {
  return {
    sessions,
    loops,
    close: (session) => {
      calls.push(`close ${session}`);
      if (session === "throws") throw new Error("tmux gone");
      return !stillOpen.has(session);
    },
    dropWorkspace,
    removeWorktree,
  };
}

beforeEach(() => {
  sessions = new Map([[IMPLEMENTER, entry()]]);
  loops = new Map([
    ["owner/repo#9", loop(9, IMPLEMENTER, "r-mine")],
    ["owner/repo#10", loop(10, OTHER, "r-other")],
  ]);
  calls = [];
  stillOpen = new Set();
  dropWorkspace.mockReset();
  dropWorkspace.mockImplementation(async (dropped) => void calls.push(`drop ${dropped.reviewer}`));
  removeWorktree.mockReset();
  removeWorktree.mockImplementation(async (worktree) => {
    calls.push(`remove ${worktree}`);
    return { removed: true };
  });
});

describe("closeImplementer", () => {
  it("closes its reviewers, then its cell, then its worktree, and forgets it", async () => {
    const result = await closeImplementer(deps(), entry());
    expect(calls).toEqual(["close r-mine", "drop r-mine", `close ${IMPLEMENTER}`, "remove /wt/7"]);
    expect(result).toEqual({ reviewersClosed: ["r-mine"], reviewersLeft: [], implementerClosed: true, worktree: { removed: true } });
    expect(sessions.has(IMPLEMENTER)).toBe(false);
    expect([...loops.keys()]).toEqual(["owner/repo#10"]);
  });

  it("leaves the worktree, and keeps the implementer to close again, when the cell would not close", async () => {
    stillOpen.add(IMPLEMENTER);
    const result = await closeImplementer(deps(), entry());
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(result.worktree).toBeNull();
    expect(result.implementerClosed).toBe(false);
    expect(sessions.has(IMPLEMENTER)).toBe(true);
    stillOpen.delete(IMPLEMENTER);
    const again = sessions.get(IMPLEMENTER);
    if (again === undefined) throw new Error("expected it kept");
    expect((await closeImplementer(deps(), again)).worktree).toEqual({ removed: true });
  });

  it("reports a reviewer that would not close, or threw, keeps its worktree, and still closes the implementer", async () => {
    loops.set("owner/repo#11", loop(11, IMPLEMENTER, "throws"));
    stillOpen.add("r-mine");
    const result = await closeImplementer(deps(), entry());
    expect(result.reviewersLeft).toEqual(["r-mine", "throws"]);
    expect(dropWorkspace).not.toHaveBeenCalled();
    expect(result.implementerClosed).toBe(true);
  });

  it("ends a loop whose reviewer is still starting without closing anything for it", async () => {
    loops.set("owner/repo#9", loop(9, IMPLEMENTER, ""));
    const result = await closeImplementer(deps(), entry());
    expect(calls).toEqual([`close ${IMPLEMENTER}`, "remove /wt/7"]);
    expect(result.reviewersClosed).toEqual([]);
    expect(loops.has("owner/repo#9")).toBe(false);
  });

  it("answers a worktree removal that threw as kept", async () => {
    removeWorktree.mockRejectedValue(new Error("git missing"));
    expect((await closeImplementer(deps(), entry())).worktree).toEqual({ removed: false, reason: "git missing" });
  });

  it("records a forced close of one still at work as ended", async () => {
    const working = entry({ finished: null });
    await closeImplementer(deps(), working);
    expect(working.finished).toBe("ended");
  });
});

interface Req {
  body: unknown;
  get(name: string): string | undefined;
}
type Handler = (req: Req, res: { json: (body: { message?: string }) => void }) => unknown;

function route(): Handler {
  let handler: Handler | undefined;
  const app = { post: (_path: string, h: Handler) => (handler = h) } as unknown as Express;
  mountIssueSessionCloseRoute(app, deps());
  if (!handler) throw new Error("route not mounted");
  return handler;
}

async function call(body: unknown, caller: string | null = PARENT): Promise<string> {
  let message = "";
  const request: Req = { body, get: (name) => (name.toLowerCase() === SESSION_HEADER ? (caller ?? undefined) : undefined) };
  await route()(request, { json: (answer) => (message = answer.message ?? "") });
  return message;
}

describe("POST /api/plugin/closeIssueSession", () => {
  it("closes a finished implementer for its starter", async () => {
    const message = await call({ session: IMPLEMENTER });
    expect(message).toContain(`owner/repo#7: Closed implementer session ${IMPLEMENTER}.`);
    expect(calls).toContain(`close ${IMPLEMENTER}`);
  });

  it("refuses another session, and closes nothing", async () => {
    expect(await call({ session: IMPLEMENTER, force: true }, OTHER)).toContain("another session");
    expect(calls).toEqual([]);
    expect(sessions.has(IMPLEMENTER)).toBe(true);
  });

  it("refuses one still at work, and closes it with force", async () => {
    sessions.set(IMPLEMENTER, entry({ finished: null }));
    expect(await call({ session: IMPLEMENTER })).toContain("still working");
    expect(calls).toEqual([]);
    expect(await call({ session: IMPLEMENTER, force: true })).toContain("Closed implementer session");
  });

  it("finds nothing the second time", async () => {
    await call({ session: IMPLEMENTER });
    expect(await call({ session: IMPLEMENTER })).toContain("already closed");
  });

  it("refuses a malformed request and a caller outside a terminal", async () => {
    expect(await call({ session: "nope" })).toContain("closeIssueSession: `session`");
    expect(await call({ session: IMPLEMENTER }, null)).toContain("only from a MulmoTerminal terminal");
    expect(calls).toEqual([]);
  });
});
