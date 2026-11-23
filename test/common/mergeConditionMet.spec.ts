// The board's "ready to merge" (#3409): the same condition requestReview reports — the declared LGTMs
// on the current head and every CI check passing — and never met without a declared `review`.
import { describe, it, expect } from "vitest";
import { mergeConditionMet, type BoardPr } from "../../common/githubBoard.js";

const lgtm = { verdicts: 1, more: false, latest: "lgtm" as const, head: "current" as const, lgtmOnHead: 1 };

const met: BoardPr = {
  number: 1,
  title: "t",
  url: "u",
  branch: "b",
  isDraft: false,
  ci: "passing",
  review: null,
  reviewRounds: 0,
  headReviewed: false,
  codex: lgtm,
  requiredLgtm: 1,
};

describe("mergeConditionMet", () => {
  it("is met with the declared LGTMs on the current head and CI passing", () => {
    expect(mergeConditionMet(met)).toBe(true);
    expect(mergeConditionMet({ ...met, requiredLgtm: 2, codex: { ...lgtm, lgtmOnHead: 3 } })).toBe(true);
  });

  it.each<[string, Partial<BoardPr>]>([
    ["no review declared", { requiredLgtm: null }],
    ["fewer LGTMs than declared", { requiredLgtm: 2 }],
    ["no verdicts at all", { codex: null }],
    ["CI running", { ci: "pending" }],
    ["CI failing", { ci: "failing" }],
    ["no CI reported", { ci: "none" }],
    ["a draft", { isDraft: true }],
  ])("is not met with %s", (_label, over) => {
    expect(mergeConditionMet({ ...met, ...over })).toBe(false);
  });
});
