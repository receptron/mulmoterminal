// @vitest-environment node
import { describe, it, expect } from "vitest";
import { waitingOnPermission, watchMessage, watchStep, type ImplementerObservation } from "../../../server/routes/issueSessionWatch.js";
import type { IssueSession } from "../../../server/routes/issueSessions.js";

const ENTRY: IssueSession = {
  session: "s-1",
  parent: "p",
  repo: "owner/repo",
  issue: 7,
  agent: "claude",
  worktree: "/wt/7",
  branch: "issue/7",
  finished: null,
  blockedTold: false,
};
const seen = (over: Partial<ImplementerObservation> = {}): ImplementerObservation => ({ running: true, pr: null, blocked: false, ...over });

describe("watchStep", () => {
  it("is quiet while the implementer works", () => {
    expect(watchStep(seen(), false)).toEqual({ event: null, finished: null, blockedTold: false });
    expect(watchStep(seen({ pr: { number: 9, state: "OPEN" } }), false).event).toBeNull();
  });

  it("finishes on a merged or closed PR, whatever else it sees", () => {
    expect(watchStep(seen({ pr: { number: 9, state: "MERGED" }, running: false, blocked: true }), false)).toMatchObject({
      event: { kind: "merged", pr: 9 },
      finished: "merged",
    });
    expect(watchStep(seen({ pr: { number: 9, state: "CLOSED" } }), false)).toMatchObject({ event: { kind: "closed", pr: 9 }, finished: "closed" });
  });

  it("finishes when the session ends with no merged PR", () => {
    expect(watchStep(seen({ running: false }), false)).toMatchObject({ event: { kind: "ended", pr: null }, finished: "ended" });
    expect(watchStep(seen({ running: false, pr: { number: 9, state: "OPEN" } }), false)).toMatchObject({ event: { kind: "ended", pr: 9 } });
  });

  it("tells a stop on the user once, and again only after it moved on", () => {
    const first = watchStep(seen({ blocked: true }), false);
    expect(first).toEqual({ event: { kind: "blocked" }, finished: null, blockedTold: true });
    expect(watchStep(seen({ blocked: true }), first.blockedTold).event).toBeNull();
    const movedOn = watchStep(seen(), first.blockedTold);
    expect(movedOn.blockedTold).toBe(false);
    expect(watchStep(seen({ blocked: true }), movedOn.blockedTold).event).toEqual({ kind: "blocked" });
  });
});

describe("waitingOnPermission", () => {
  it("is a newest hook that reports a block, not a turn that ended or moved on", () => {
    expect(waitingOnPermission("Notification")).toBe(true);
    ["Stop", "UserPromptSubmit", "PreToolUse", "PostToolUse", "StopFailure", undefined].forEach((event) =>
      expect(waitingOnPermission(event), String(event)).toBe(false),
    );
  });
});

describe("watchMessage", () => {
  it("names the issue, the session and the PR, and says what to do next", () => {
    const merged = watchMessage(ENTRY, { kind: "merged", pr: 9 }, 1, 2);
    expect(merged.startsWith("[startIssueSession] owner/repo#7 (session s-1)")).toBe(true);
    expect(merged).toContain("PR #9 was merged");
    expect(merged).toContain("1 of 2");
    expect(watchMessage(ENTRY, { kind: "closed", pr: null }, 0, 2)).toContain("its PR was closed without merging");
    expect(watchMessage(ENTRY, { kind: "ended", pr: null }, 0, 2)).toContain("session ended before its PR was merged");
    expect(watchMessage(ENTRY, { kind: "blocked" }, 1, 2)).toContain("do not answer it for them");
  });
});
