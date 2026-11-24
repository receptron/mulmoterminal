// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseBranchPr } from "../../../server/git/pr-of-branch.js";
import { PR_UNREADABLE } from "../../../server/routes/issueSessionWatch.js";

const STARTED = Date.parse("2026-11-24T06:00:00Z");
const BEFORE = "2026-11-24T05:59:59Z";
const AFTER = "2026-11-24T06:00:01Z";
const parse = (stdout: string): ReturnType<typeof parseBranchPr> => parseBranchPr(stdout, STARTED);

describe("parseBranchPr", () => {
  it("takes the newest PR from the branch", () => {
    expect(parse(`[{"number":12,"state":"MERGED","mergedAt":"${AFTER}"},{"number":9,"state":"CLOSED","closedAt":"${AFTER}"}]`)).toEqual({
      number: 12,
      state: "MERGED",
    });
    expect(parse('[{"number":9,"state":"OPEN"}]')).toEqual({ number: 9, state: "OPEN" });
  });

  it("is none when the list has no well-formed PR", () => {
    ["[]", '[{"number":"9","state":"OPEN"}]', '[{"number":9,"state":"DRAFT"}]', "[null]"].forEach((stdout) => expect(parse(stdout), stdout).toBeNull());
  });

  // Not "no PR": the watch must not finish an implementer on an answer it could not read.
  it("is unreadable when the answer is not a list", () => {
    ["", "not json", "{}", "null", '"x"'].forEach((stdout) => expect(parse(stdout), stdout).toBe(PR_UNREADABLE));
  });

  it("skips a malformed row for the next well-formed one", () => {
    expect(parse(`[{"state":"OPEN"},{"number":9,"state":"CLOSED","closedAt":"${AFTER}"}]`)).toEqual({ number: 9, state: "CLOSED" });
  });

  // #3440: the issue's branch keeps its name, so a PR an earlier attempt closed is still listed.
  describe("a PR that was over before the implementer started", () => {
    it.each([
      ["closed", `{"number":3422,"state":"CLOSED","closedAt":"${BEFORE}"}`],
      ["merged", `{"number":3422,"state":"MERGED","mergedAt":"${BEFORE}","closedAt":"${BEFORE}"}`],
    ])("is not its answer when it was %s before", (_label, row) => {
      expect(parse(`[${row}]`)).toBeNull();
    });

    it("gives way to an older one that is still open, or to a newer one", () => {
      expect(parse(`[{"number":30,"state":"CLOSED","closedAt":"${BEFORE}"},{"number":20,"state":"OPEN"}]`)).toEqual({ number: 20, state: "OPEN" });
      expect(parse(`[{"number":31,"state":"CLOSED","closedAt":"${AFTER}"},{"number":30,"state":"CLOSED","closedAt":"${BEFORE}"}]`)).toEqual({
        number: 31,
        state: "CLOSED",
      });
    });

    it("counts once reopened, as open", () => {
      expect(parse('[{"number":3422,"state":"OPEN","closedAt":null}]')).toEqual({ number: 3422, state: "OPEN" });
    });

    it("counts when it ended at the very moment of the start, or after", () => {
      expect(parse(`[{"number":9,"state":"CLOSED","closedAt":"2026-11-24T06:00:00Z"}]`)).toEqual({ number: 9, state: "CLOSED" });
      expect(parse(`[{"number":9,"state":"MERGED","mergedAt":"${AFTER}","closedAt":"${BEFORE}"}]`)).toEqual({ number: 9, state: "MERGED" });
    });

    it.each([
      ["no end time", '{"number":9,"state":"CLOSED"}'],
      ["an end time that does not parse", '{"number":9,"state":"CLOSED","closedAt":"soon"}'],
      ["an end time of the wrong type", '{"number":9,"state":"CLOSED","closedAt":5}'],
    ])("still counts a closed PR with %s, as before the time was asked for", (_label, row) => {
      expect(parse(`[${row}]`)).toEqual({ number: 9, state: "CLOSED" });
    });
  });
});
