// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseBranchPr } from "../../../server/git/pr-of-branch.js";
import { PR_UNREADABLE } from "../../../server/routes/issueSessionWatch.js";

describe("parseBranchPr", () => {
  it("takes the newest PR from the branch", () => {
    expect(parseBranchPr('[{"number":12,"state":"MERGED"},{"number":9,"state":"CLOSED"}]')).toEqual({ number: 12, state: "MERGED" });
    expect(parseBranchPr('[{"number":9,"state":"OPEN"}]')).toEqual({ number: 9, state: "OPEN" });
  });

  it("is none when the list has no well-formed PR", () => {
    ["[]", '[{"number":"9","state":"OPEN"}]', '[{"number":9,"state":"DRAFT"}]', "[null]"].forEach((stdout) => expect(parseBranchPr(stdout), stdout).toBeNull());
  });

  // Not "no PR": the watch must not finish an implementer on an answer it could not read.
  it("is unreadable when the answer is not a list", () => {
    ["", "not json", "{}", "null", '"x"'].forEach((stdout) => expect(parseBranchPr(stdout), stdout).toBe(PR_UNREADABLE));
  });

  it("skips a malformed row for the next well-formed one", () => {
    expect(parseBranchPr('[{"state":"OPEN"},{"number":9,"state":"CLOSED"}]')).toEqual({ number: 9, state: "CLOSED" });
  });
});
