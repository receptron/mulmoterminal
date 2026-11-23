// @vitest-environment node
// One PR's state for the review loop (#3409), read out of `gh pr view --json`.
import { describe, it, expect } from "vitest";
import { parsePrReviewState } from "../../../server/git/pr-review-state.js";

describe("parsePrReviewState", () => {
  it("reads whether it is open, its head in lower case, and CI rolled up", () => {
    const stdout = JSON.stringify({ state: "OPEN", headRefOid: "ABCDEF0123", statusCheckRollup: [{ conclusion: "SUCCESS" }] });
    expect(parsePrReviewState(stdout)).toEqual({ open: true, head: "abcdef0123", ci: "passing" });
  });

  it("reads a merged or closed PR as not open, and no checks as none", () => {
    expect(parsePrReviewState(JSON.stringify({ state: "MERGED", headRefOid: "abc", statusCheckRollup: [] }))).toEqual({ open: false, head: "abc", ci: "none" });
    expect(parsePrReviewState(JSON.stringify({ state: "CLOSED", headRefOid: "abc" }))?.open).toBe(false);
  });

  it.each([[""], ["not json"], ["[]"], ["null"], [JSON.stringify({ state: "OPEN" })], [JSON.stringify({ state: "OPEN", headRefOid: 7 })]])(
    "is null for what is not a PR: %s",
    (stdout) => {
      expect(parsePrReviewState(stdout)).toBeNull();
    },
  );
});
