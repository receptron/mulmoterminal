// @vitest-environment node
// The watch over startIssueSession's implementers (#3413): what must not happen is a finished one
// still holding a place, the same block told twice, a line typed into a starter that is gone, or one
// implementer's failure stopping the look at the others.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { watchIssueSessions, type IssueSessionWatchDeps } from "../../../server/routes/issue-session-watch.js";
import type { IssueSession } from "../../../server/routes/issueSessions.js";
import type { BranchPr } from "../../../server/git/pr-of-branch.js";

const entry = (session: string, issue: number, parent = "parent"): IssueSession => ({
  session,
  parent,
  repo: "owner/repo",
  issue,
  agent: "claude",
  worktree: `/wt/${issue}`,
  branch: `issue/${issue}`,
  finished: null,
  blockedTold: false,
});

let sessions: Map<string, IssueSession>;
let running: Set<string>;
let prs: Map<string, BranchPr | null>;
let blockedSessions: Set<string>;
const deliver = vi.fn<IssueSessionWatchDeps["deliver"]>();
const prOf = vi.fn<IssueSessionWatchDeps["prOf"]>();

function deps(): IssueSessionWatchDeps {
  return {
    sessions,
    isRunning: (session) => running.has(session),
    prOf,
    blocked: async (session) => blockedSessions.has(session),
    deliver,
    limit: () => 2,
  };
}

const told = (): Array<[string, string]> => deliver.mock.calls.map(([parent, text]) => [parent, text]);

beforeEach(() => {
  sessions = new Map([
    ["s-1", entry("s-1", 7)],
    ["s-2", entry("s-2", 8)],
  ]);
  running = new Set(["parent", "s-1", "s-2"]);
  prs = new Map();
  blockedSessions = new Set();
  deliver.mockReset();
  deliver.mockImplementation(async () => undefined);
  prOf.mockReset();
  prOf.mockImplementation(async (_repo, branch) => prs.get(branch) ?? null);
});

describe("watchIssueSessions", () => {
  it("tells the starter nothing while its implementers work", async () => {
    prs.set("issue/7", { number: 9, state: "OPEN" });
    await watchIssueSessions(deps());
    expect(deliver).not.toHaveBeenCalled();
  });

  it("records a merge, frees its place, tells the starter once, and stops looking at it", async () => {
    prs.set("issue/7", { number: 9, state: "MERGED" });
    await watchIssueSessions(deps());
    expect(sessions.get("s-1")?.finished).toBe("merged");
    expect(told()).toEqual([["parent", expect.stringContaining("PR #9 was merged. 1 of 2 implementers are running")]]);
    prOf.mockClear();
    await watchIssueSessions(deps());
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(prOf.mock.calls.map(([, branch]) => branch)).toEqual(["issue/8"]);
  });

  it("records an implementer whose session ended", async () => {
    running.delete("s-2");
    await watchIssueSessions(deps());
    expect(sessions.get("s-2")?.finished).toBe("ended");
    expect(told()[0]?.[1]).toContain("owner/repo#8 (session s-2): its session ended");
  });

  it("tells a stop on the user once while it lasts, and does not finish the implementer", async () => {
    blockedSessions.add("s-1");
    await watchIssueSessions(deps());
    await watchIssueSessions(deps());
    expect(told()).toEqual([["parent", expect.stringContaining("is waiting for the user in its cell")]]);
    expect(sessions.get("s-1")?.finished).toBeNull();
    blockedSessions.delete("s-1");
    await watchIssueSessions(deps());
    blockedSessions.add("s-1");
    await watchIssueSessions(deps());
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  // The place is the machine's: it is given back even when nobody is left to hear about it.
  it("still follows the implementers of a starter that is gone, and the line knows the starter is gone", async () => {
    running.delete("parent");
    prs.set("issue/7", { number: 9, state: "MERGED" });
    await watchIssueSessions(deps());
    expect(sessions.get("s-1")?.finished).toBe("merged");
    const ended = deliver.mock.calls[0]?.[2];
    expect(ended?.()).toBe(true);
    running.add("parent");
    expect(ended?.()).toBe(false);
  });

  it("does not ask gh about an implementer with no branch", async () => {
    sessions.set("s-1", { ...entry("s-1", 7), branch: null });
    await watchIssueSessions(deps());
    expect(prOf.mock.calls.map(([, branch]) => branch)).toEqual(["issue/8"]);
  });

  it("keeps looking at the others when one look fails, or a delivery throws", async () => {
    prOf.mockImplementation(async (_repo, branch) => {
      if (branch === "issue/7") throw new Error("gh down");
      return { number: 10, state: "CLOSED" };
    });
    deliver.mockImplementation(async () => {
      throw new Error("pty gone");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await watchIssueSessions(deps());
    await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(2));
    errors.mockRestore();
    expect(sessions.get("s-1")?.finished).toBeNull();
    expect(sessions.get("s-2")?.finished).toBe("closed");
  });
});
