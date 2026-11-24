// @vitest-environment node
// The watch over startIssueSession's implementers (#3413): what must not happen is a finished one
// still holding a place, the same block told twice, a line typed into a starter that is gone, or one
// implementer's failure stopping the look at the others.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { startIssueSessionWatch, watchIssueSessions, type IssueSessionWatchDeps } from "../../../server/routes/issue-session-watch.js";
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
  prUnreadable: 0,
});

let sessions: Map<string, IssueSession>;
let running: Set<string>;
let prs: Map<string, BranchPr | null>;
let blockedSessions: Set<string>;
const deliver = vi.fn<IssueSessionWatchDeps["deliver"]>();
const prOf = vi.fn<IssueSessionWatchDeps["prOf"]>();
const closeFinished = vi.fn<IssueSessionWatchDeps["closeFinished"]>();

function deps(): IssueSessionWatchDeps {
  return {
    sessions,
    isRunning: (session) => running.has(session),
    prOf,
    blocked: async (session) => blockedSessions.has(session),
    deliver,
    limit: () => 2,
    closeFinished,
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
  closeFinished.mockReset();
  closeFinished.mockImplementation(async (closing) => `Closed implementer session ${closing.session}.`);
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

  it("does not finish an ended implementer on a pass gh could not answer, and sees its merge later", async () => {
    running.delete("s-2");
    prOf.mockImplementation(async (_repo, branch) => (branch === "issue/8" ? "unreadable" : null));
    await watchIssueSessions(deps());
    expect(sessions.get("s-2")?.finished).toBeNull();
    expect(deliver).not.toHaveBeenCalled();
    prOf.mockImplementation(async (_repo, branch) => (branch === "issue/8" ? { number: 11, state: "MERGED" } : null));
    await watchIssueSessions(deps());
    expect(sessions.get("s-2")?.finished).toBe("merged");
    expect(told()[0]?.[1]).toContain("PR #11 was merged");
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

  it("closes an implementer once its PR is merged or closed, and says so in the line", async () => {
    prs.set("issue/7", { number: 9, state: "MERGED" });
    prs.set("issue/8", { number: 10, state: "CLOSED" });
    await watchIssueSessions(deps());
    expect(closeFinished.mock.calls.map(([closing]) => closing.session).sort()).toEqual(["s-1", "s-2"]);
    expect(told().map(([, text]) => text)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/was merged\. .* Closed implementer session s-1\.$/),
        expect.stringMatching(/Closed implementer session s-2\.$/),
      ]),
    );
  });

  it("leaves an implementer whose session ended, or that is waiting, for the starter to close", async () => {
    running.delete("s-2");
    blockedSessions.add("s-1");
    await watchIssueSessions(deps());
    expect(closeFinished).not.toHaveBeenCalled();
  });

  it("still tells the starter about the merge when the close throws", async () => {
    prs.set("issue/7", { number: 9, state: "MERGED" });
    closeFinished.mockRejectedValue(new Error("tmux gone"));
    await watchIssueSessions(deps());
    expect(told()[0]?.[1]).toContain("was merged. 1 of 2 implementers are running; start the next issue if one is left. Could not close it: tmux gone.");
  });

  it("says nothing about an implementer closeIssueSession closed while gh was asked", async () => {
    prOf.mockImplementation(async (_repo, branch) => {
      if (branch === "issue/7") sessions.delete("s-1");
      return { number: 9, state: "MERGED" };
    });
    await watchIssueSessions(deps());
    expect(
      told()
        .map(([, text]) => text)
        .some((text) => text.includes("s-1")),
    ).toBe(false);
  });

  it("does not ask gh about an implementer with no branch", async () => {
    sessions.set("s-1", { ...entry("s-1", 7), branch: null });
    await watchIssueSessions(deps());
    expect(prOf.mock.calls.map(([, branch]) => branch)).toEqual(["issue/8"]);
  });

  it("keeps looking at the others when one look fails, or a delivery throws", async () => {
    // A gh that threw outright, not one that answered nothing readable.
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

describe("startIssueSessionWatch", () => {
  // A slow gh must not stack passes: the next look is scheduled when one ENDS, not on a fixed beat.
  it("starts the next pass only after the one before it finished", async () => {
    vi.useFakeTimers();
    try {
      let release: () => void = () => undefined;
      prOf.mockImplementation(
        () =>
          new Promise<null>((resolve) => {
            release = () => resolve(null);
          }),
      );
      sessions = new Map([["s-1", entry("s-1", 7)]]);
      startIssueSessionWatch(deps(), 10);
      expect(prOf).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10);
      expect(prOf).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(prOf).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(9);
      expect(prOf).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(prOf).toHaveBeenCalledTimes(2);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
