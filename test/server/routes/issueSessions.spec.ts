// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  implementerSeed,
  limitRefusal,
  parseStartRequest,
  runningCount,
  runningFor,
  startedMessage,
  type IssueSession,
} from "../../../server/routes/issueSessions.js";
import { DEFAULT_MAX_ISSUE_SESSIONS, MAX_MAX_ISSUE_SESSIONS, MIN_MAX_ISSUE_SESSIONS, sanitizeMaxIssueSessions } from "../../../common/issueSessionLimit.js";

const entry = (session: string, issue = 7, repo = "owner/repo"): IssueSession => ({
  session,
  parent: "p",
  repo,
  issue,
  agent: "claude",
  worktree: `/wt/${issue}`,
  branch: `issue/${issue}`,
  finished: null,
  blockedTold: false,
  prUnreadable: 0,
});

describe("parseStartRequest", () => {
  it("takes a repo, an issue and an agent that carries every tool, defaulting to claude", () => {
    expect(parseStartRequest({ repo: "owner/repo", issue: 7 })).toEqual({ ok: true, repo: "owner/repo", issue: 7, agent: "claude" });
    expect(parseStartRequest({ repo: "owner/repo", issue: 7, agent: "codex" })).toMatchObject({ ok: true, agent: "codex" });
    expect(parseStartRequest({ repo: "owner/repo", issue: 7, agent: "copilot" })).toMatchObject({ ok: true, agent: "copilot" });
  });

  // The others read their MCP from a file the directory's other sessions share, so they cannot carry the review tools alone.
  it.each(["grok", "muse", "antigravity", "cursor", "shell", "nobody", 3, null])("refuses agent %s", (agent) => {
    expect(parseStartRequest({ repo: "owner/repo", issue: 7, agent })).toMatchObject({ ok: false });
  });

  it.each([
    {},
    null,
    "x",
    { repo: "owner/repo" },
    { issue: 7 },
    { repo: "not a repo", issue: 7 },
    { repo: "owner/repo", issue: 0 },
    { repo: "owner/repo", issue: "7" },
  ])("refuses %j", (body) => {
    expect(parseStartRequest(body)).toMatchObject({ ok: false });
  });
});

describe("the limit", () => {
  it("counts implementers still running, and starts in flight", () => {
    const sessions = [entry("a"), entry("b", 8), entry("c", 9)];
    expect(runningCount(sessions, (s) => s !== "b", 0)).toBe(2);
    expect(runningCount(sessions, (s) => s !== "b", 1)).toBe(3);
    expect(runningCount([], () => true, 0)).toBe(0);
  });

  // A merged implementer's cell may stay open for the user to read; it no longer holds a place.
  it("does not count an implementer the watch saw finish, though its session still runs", () => {
    const merged = { ...entry("a"), finished: "merged" as const };
    expect(runningCount([merged, entry("b", 8)], () => true, 0)).toBe(1);
    expect(runningFor([merged], { repo: "owner/repo", issue: 7 }, () => true)).toBeUndefined();
  });

  it("refuses at the limit and past it, and not below", () => {
    expect(limitRefusal(1, 2)).toBeNull();
    expect(limitRefusal(2, 2)).toContain("(2)");
    expect(limitRefusal(3, 2)).not.toBeNull();
  });

  it("is a whole number within range, and the default otherwise — never no limit", () => {
    expect(sanitizeMaxIssueSessions(MIN_MAX_ISSUE_SESSIONS)).toBe(MIN_MAX_ISSUE_SESSIONS);
    expect(sanitizeMaxIssueSessions(MAX_MAX_ISSUE_SESSIONS)).toBe(MAX_MAX_ISSUE_SESSIONS);
    [0, -1, MAX_MAX_ISSUE_SESSIONS + 1, 2.5, "3", null, undefined, Number.NaN, Infinity].forEach((value) =>
      expect(sanitizeMaxIssueSessions(value), String(value)).toBe(DEFAULT_MAX_ISSUE_SESSIONS),
    );
  });
});

describe("runningFor", () => {
  it("finds the running implementer of the same issue in the same repo only", () => {
    const sessions = [entry("a", 7), entry("b", 7, "owner/other")];
    expect(runningFor(sessions, { repo: "owner/repo", issue: 7 }, () => true)?.session).toBe("a");
    expect(runningFor(sessions, { repo: "owner/repo", issue: 8 }, () => true)).toBeUndefined();
    expect(runningFor(sessions, { repo: "owner/repo", issue: 7 }, (s) => s !== "a")).toBeUndefined();
  });
});

describe("what the implementer and the caller are told", () => {
  it("names the skill and the issue in prose, and says where questions go", () => {
    const seed = implementerSeed({ repo: "owner/repo", issue: 7 }, "parent-1");
    expect(seed).toContain('"mulmoterminal-issue-to-merge"');
    expect(seed).toContain("owner/repo#7");
    expect(seed).toContain("parent-1");
    expect(seed.startsWith("/")).toBe(false);
  });

  it("reports the session, the worktree and how many are running", () => {
    expect(startedMessage(entry("s-1"), 2, 3)).toMatch(/s-1.*owner\/repo#7.*\/wt\/7.*2 of 3/s);
  });
});
