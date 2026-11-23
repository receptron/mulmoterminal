// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseBranchPr } from "../../../server/git/pr-of-branch.js";

describe("parseBranchPr", () => {
  it("takes the newest PR from the branch", () => {
    expect(parseBranchPr('[{"number":12,"state":"MERGED"},{"number":9,"state":"CLOSED"}]')).toEqual({ number: 12, state: "MERGED" });
    expect(parseBranchPr('[{"number":9,"state":"OPEN"}]')).toEqual({ number: 9, state: "OPEN" });
  });

  it("is none when there is no PR, or the answer is not one", () => {
    ["[]", "", "not json", "{}", "null", '[{"number":"9","state":"OPEN"}]', '[{"number":9,"state":"DRAFT"}]', "[null]"].forEach((stdout) =>
      expect(parseBranchPr(stdout), stdout).toBeNull(),
    );
  });

  it("skips a malformed row for the next well-formed one", () => {
    expect(parseBranchPr('[{"state":"OPEN"},{"number":9,"state":"CLOSED"}]')).toEqual({ number: 9, state: "CLOSED" });
  });
});
