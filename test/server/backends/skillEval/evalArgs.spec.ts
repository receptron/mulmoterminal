// @vitest-environment node
// What the rubric grader is told (#3514): every item must hold, the files are the evidence, and an item is judged by
// its meaning, so a run without the skill is not failed for not using the skill's own words.
import { describe, it, expect } from "vitest";
import { judgePrompt } from "../../../../server/backends/skillEval/evalArgs";
import type { SkillEvalCase } from "../../../../common/skillEval";

const evalCase: SkillEvalCase = {
  ...{ id: "plan", title: "Plan the review", kind: "use", prompt: "Decide how much review the PR needs." },
  check: { type: "rubric", items: ["says no external reviewer round is needed"] },
};

describe("judgePrompt", () => {
  it("judges each item by its meaning, not by its wording", () => {
    const prompt = judgePrompt(evalCase, ["says no external reviewer round is needed"], "done");
    expect(prompt).toContain("Judge each item by what it means, not by its wording");
    expect(prompt).toContain("even without the item's own terms");
  });

  it("still needs every item, checked against the files rather than the agent's word", () => {
    const prompt = judgePrompt(evalCase, ["first", "second"], "");
    expect(prompt).toContain("Pass only if EVERY item below holds");
    expect(prompt).toContain("Check the files themselves");
    expect(prompt).toContain("1. first\n2. second");
    expect(prompt).toContain("(none)");
    expect(prompt).toContain("Decide how much review the PR needs.");
  });
});
