// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  ENDED_UNREADABLE_PASSES,
  PR_UNREADABLE,
  waitingOnPermission,
  watchMessage,
  watchStep,
  type ImplementerObservation,
  type WatchMemory,
} from "../../../server/routes/issueSessionWatch.js";
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
  prUnreadable: 0,
};
const fresh: WatchMemory = { blockedTold: false, prUnreadable: 0 };
const seen = (over: Partial<ImplementerObservation> = {}): ImplementerObservation => ({ running: true, pr: null, blocked: false, ...over });

describe("watchStep", () => {
  it("is quiet while the implementer works", () => {
    expect(watchStep(seen(), fresh)).toEqual({ event: null, finished: null, blockedTold: false, prUnreadable: 0 });
    expect(watchStep(seen({ pr: { number: 9, state: "OPEN" } }), fresh).event).toBeNull();
  });

  it("finishes on a merged or closed PR, whatever else it sees", () => {
    expect(watchStep(seen({ pr: { number: 9, state: "MERGED" }, running: false, blocked: true }), fresh)).toMatchObject({
      event: { kind: "merged", pr: 9 },
      finished: "merged",
    });
    expect(watchStep(seen({ pr: { number: 9, state: "CLOSED" } }), fresh)).toMatchObject({ event: { kind: "closed", pr: 9 }, finished: "closed" });
  });

  it("finishes when the session ends with no merged PR", () => {
    expect(watchStep(seen({ running: false }), fresh)).toMatchObject({ event: { kind: "ended", pr: null }, finished: "ended" });
    expect(watchStep(seen({ running: false, pr: { number: 9, state: "OPEN" } }), fresh)).toMatchObject({ event: { kind: "ended", pr: 9 } });
  });

  it("tells a stop on the user once, and again only after it moved on", () => {
    const first = watchStep(seen({ blocked: true }), fresh);
    expect(first).toEqual({ event: { kind: "blocked" }, finished: null, blockedTold: true, prUnreadable: 0 });
    expect(watchStep(seen({ blocked: true }), first).event).toBeNull();
    const movedOn = watchStep(seen(), first);
    expect(movedOn.blockedTold).toBe(false);
    expect(watchStep(seen({ blocked: true }), movedOn).event).toEqual({ kind: "blocked" });
  });

  // A pass on which gh could not answer is not "no PR": a merge it did not see must not become "ended".
  it("never finishes on a PR it could not read, and gives up on an ended one only after a run of them", () => {
    expect(watchStep(seen({ pr: PR_UNREADABLE }), fresh)).toEqual({ event: null, finished: null, blockedTold: false, prUnreadable: 1 });
    expect(watchStep(seen({ pr: PR_UNREADABLE, blocked: true }), fresh).event).toEqual({ kind: "blocked" });
    let memory = fresh;
    for (let pass = 1; pass < ENDED_UNREADABLE_PASSES; pass += 1) {
      const step = watchStep(seen({ running: false, pr: PR_UNREADABLE }), memory);
      expect(step.finished, `pass ${pass}`).toBeNull();
      memory = step;
    }
    const merged = watchStep(seen({ running: false, pr: { number: 9, state: "MERGED" } }), memory);
    expect(merged).toMatchObject({ event: { kind: "merged", pr: 9 }, finished: "merged", prUnreadable: 0 });
    const gaveUp = watchStep(seen({ running: false, pr: PR_UNREADABLE }), memory);
    expect(gaveUp).toMatchObject({ event: { kind: "ended", pr: null, prUnread: true }, finished: "ended" });
    expect(watchMessage(ENTRY, { kind: "ended", pr: null, prUnread: true }, 0, 2)).toContain("gh could not say how its PR stands");
  });
});

describe("waitingOnPermission", () => {
  it("is a newest hook that reports a block, not a turn that ended or moved on", () => {
    expect(waitingOnPermission("Notification")).toBe(true);
    ["Stop", "UserPromptSubmit", "PreToolUse", "PostToolUse", "StopFailure", "Notification:idle_prompt", undefined].forEach((event) =>
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
