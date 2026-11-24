// @vitest-environment node
// closeIssueSession's pure half (#3428): who may close whom, and when a worktree may go.
import { describe, it, expect } from "vitest";
import { closeRefusal, closeSummary, parseCloseRequest, worktreeVerdict, type CloseResult } from "../../../server/routes/issueSessionClose.js";
import type { IssueSession } from "../../../server/routes/issueSessions.js";

const PARENT = "0b7d2c1e-1111-4222-8333-944455556666";
const IMPLEMENTER = "1c8e3d2f-2222-4333-8444-a55566667777";

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

describe("parseCloseRequest", () => {
  it("takes a session id, with force off unless it is exactly true", () => {
    expect(parseCloseRequest({ session: IMPLEMENTER })).toEqual({ ok: true, session: IMPLEMENTER, force: false });
    expect(parseCloseRequest({ session: IMPLEMENTER, force: true })).toEqual({ ok: true, session: IMPLEMENTER, force: true });
    expect(parseCloseRequest({ session: IMPLEMENTER, force: "true" })).toEqual({ ok: true, session: IMPLEMENTER, force: false });
    expect(parseCloseRequest({ session: IMPLEMENTER, force: 1 })).toEqual({ ok: true, session: IMPLEMENTER, force: false });
  });

  it.each([[undefined], [null], ["text"], [{}], [{ session: "" }], [{ session: "not-an-id" }], [{ session: 7 }]])("refuses %j", (body) => {
    expect(parseCloseRequest(body).ok).toBe(false);
  });
});

describe("closeRefusal", () => {
  const request = { session: IMPLEMENTER, force: false };

  it("lets the starter close a finished implementer", () => {
    expect(closeRefusal(entry({ finished: "merged" }), request, PARENT)).toBeNull();
    expect(closeRefusal(entry({ finished: "closed" }), request, PARENT)).toBeNull();
    expect(closeRefusal(entry({ finished: "ended" }), request, PARENT)).toBeNull();
  });

  it("refuses a session it does not know", () => {
    expect(closeRefusal(undefined, request, PARENT)).toContain("not an implementer");
  });

  it("refuses any session but the starter, even with force", () => {
    expect(closeRefusal(entry(), request, IMPLEMENTER)).toContain("another session");
    expect(closeRefusal(entry(), { ...request, force: true }, "someone-else")).toContain("another session");
  });

  it("refuses one still at work unless forced", () => {
    expect(closeRefusal(entry({ finished: null }), request, PARENT)).toContain("still working on owner/repo#7");
    expect(closeRefusal(entry({ finished: null }), { ...request, force: true }, PARENT)).toBeNull();
  });
});

describe("worktreeVerdict", () => {
  it("removes only a worktree with nothing unpushed", () => {
    expect(worktreeVerdict({ exists: true, dirty: false, unpushed: 0 })).toEqual({ remove: true });
  });

  it.each([
    [{ exists: false, dirty: false, unpushed: 0 }, "already gone"],
    [{ exists: true, dirty: true, unpushed: 0 }, "uncommitted changes"],
    [{ exists: true, dirty: false, unpushed: 3 }, "no remote has (3)"],
    [{ exists: true, dirty: true, unpushed: 3 }, "uncommitted changes"],
    [{ exists: true, dirty: null, unpushed: 0 }, "could not say"],
    [{ exists: true, dirty: false, unpushed: null }, "could not say"],
    [{ exists: true, dirty: null, unpushed: null }, "could not say"],
  ])("keeps %j", (facts, reason) => {
    const verdict = worktreeVerdict(facts);
    expect(verdict.remove).toBe(false);
    if (!verdict.remove) expect(verdict.reason).toContain(reason);
  });
});

describe("closeSummary", () => {
  const closed: CloseResult = { reviewersClosed: [], reviewersLeft: [], implementerClosed: true, worktree: { removed: true } };

  it("names the worktree and local branch removed, and says the remote branch stays", () => {
    expect(closeSummary(entry(), closed)).toBe(
      `Closed implementer session ${IMPLEMENTER}. Removed its worktree /wt/7 and local branch issue/7-thing (the remote branch stays).`,
    );
  });

  it("says why a worktree was kept", () => {
    expect(closeSummary(entry(), { ...closed, worktree: { removed: false, reason: "it has uncommitted changes" } })).toContain(
      "Kept its worktree /wt/7: it has uncommitted changes.",
    );
  });

  it("names the reviewers closed and the ones left", () => {
    const text = closeSummary(entry(), { ...closed, reviewersClosed: ["r-1"], reviewersLeft: ["r-2"] });
    expect(text).toContain("Closed its reviewer sessions r-1.");
    expect(text).toContain("Could not close reviewer sessions r-2");
  });

  it("asks for the cell to be closed by hand, and leaves the worktree, when the implementer did not close", () => {
    const text = closeSummary(entry(), { ...closed, implementerClosed: false, worktree: null });
    expect(text).toContain(`Could not close implementer session ${IMPLEMENTER}: close its cell by hand.`);
    expect(text).toContain("Left its worktree /wt/7, since its cell is still open.");
  });

  it("leaves the branch out when there is none", () => {
    expect(closeSummary(entry({ branch: null }), closed)).toContain("Removed its worktree /wt/7.");
  });
});
