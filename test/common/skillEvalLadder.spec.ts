// What a search for the cheapest model that is enough found (#3453): the cheapest that passed as often as
// the best, models above a step that passed everything left unmeasured, passes that never read the skill
// not counted, and when the choice is shaky.
import { describe, it, expect } from "vitest";
import { ladderStepPassedAll, summarizeLadder } from "../../common/skillEvalLadder";
import { isBaselineFor, ladderAttempts, maxLadderCostUsd, skillEvalRunSchema, skillEvalSetSchema, type SkillEvalAttempt } from "../../common/skillEval";

const LADDER = ["haiku", "sonnet", "opus"];

function attempt(model: string, pass: boolean, extra: Partial<SkillEvalAttempt> = {}): SkillEvalAttempt {
  return {
    ...{ caseId: "a", arm: "with", round: 0, pass, skillInvoked: true, costUsd: 0.1, gradingCostUsd: 0.01, durationMs: 0 },
    ...{ finalText: "", checkOutput: "", denied: [], error: null, model },
    ...extra,
  };
}
const step = (model: string, passes: number, of: number): SkillEvalAttempt[] => Array.from({ length: of }, (_, i) => attempt(model, i < passes, { round: i }));

describe("summarizeLadder", () => {
  it("picks the cheapest model that passed as often as the best one", () => {
    const summary = summarizeLadder(LADDER, [...step("haiku", 1, 3), ...step("sonnet", 2, 3), ...step("opus", 2, 3)]);
    expect(summary.enough).toBe("sonnet");
    expect(summary.steps.map((s) => [s.model, s.passes, s.attempts])).toEqual([
      ["haiku", 1, 3],
      ["sonnet", 2, 3],
      ["opus", 2, 3],
    ]);
    expect(summary.shaky).toBe(false);
  });

  it("leaves the models above a step that passed everything unmeasured, and is not shaky about it", () => {
    const summary = summarizeLadder(LADDER, step("haiku", 3, 3));
    expect(summary.enough).toBe("haiku");
    expect(summary.steps.map((s) => s.measured)).toEqual([true, false, false]);
    expect(summary.steps[1]).toMatchObject({ passRate: null, costPerPassUsd: null });
    expect(summary.shaky).toBe(false);
  });

  it("names no model when none passed, and calls a choice resting on one model shaky", () => {
    expect(summarizeLadder(LADDER, [...step("haiku", 0, 3), ...step("sonnet", 0, 3), ...step("opus", 0, 3)]).enough).toBeNull();
    expect(summarizeLadder(LADDER, []).enough).toBeNull();
    const onlyOpus = summarizeLadder(LADDER, [...step("haiku", 0, 3), ...step("sonnet", 0, 3), ...step("opus", 2, 3)]);
    expect(onlyOpus).toMatchObject({ enough: "opus", shaky: true });
  });

  it("counts a pass only when the skill was read, and costs a pass with the failures included", () => {
    const attempts = [attempt("haiku", true), attempt("haiku", true, { skillInvoked: false }), attempt("haiku", false)];
    const [haiku] = summarizeLadder(["haiku"], attempts).steps;
    expect(haiku).toMatchObject({ passes: 1, attempts: 3 });
    expect(haiku?.costPerPassUsd).toBeCloseTo(0.3);
    expect(summarizeLadder(["haiku"], attempts).gradingCostUsd).toBeCloseTo(0.03);
  });

  it("ignores attempts on a model that is not on the ladder", () => {
    expect(summarizeLadder(["haiku"], step("other", 3, 3))).toMatchObject({ enough: null, steps: [{ model: "haiku", measured: false }] });
  });
});

describe("ladderStepPassedAll", () => {
  it("holds only when every planned attempt passed with the skill read", () => {
    expect(ladderStepPassedAll(step("haiku", 3, 3), 3)).toBe(true);
    expect(ladderStepPassedAll(step("haiku", 2, 3), 3)).toBe(false);
    expect(ladderStepPassedAll(step("haiku", 2, 2), 3)).toBe(false);
    expect(ladderStepPassedAll([attempt("haiku", true, { skillInvoked: false })], 1)).toBe(false);
    expect(ladderStepPassedAll([], 0)).toBe(false);
  });
});

describe("the ladder in a set and a run", () => {
  const useCase = { id: "u", title: "u", kind: "use", prompt: "p", check: { type: "rubric", items: ["x"] } };
  const avoidCase = { id: "v", title: "v", kind: "avoid", prompt: "p", check: { type: "command", command: "true" } };
  const set = skillEvalSetSchema.parse({ version: 1, skill: "s", repeats: 2, cases: [useCase, avoidCase] });

  it("climbs haiku, sonnet, opus unless the set names its own", () => {
    expect(set.ladder).toEqual(LADDER);
    expect(skillEvalSetSchema.parse({ version: 1, skill: "s", ladder: ["a"], cases: [useCase] }).ladder).toEqual(["a"]);
    expect(skillEvalSetSchema.safeParse({ version: 1, skill: "s", ladder: [], cases: [useCase] }).success).toBe(false);
  });

  it("plans the use cases on every model, and caps the cost with their grading", () => {
    expect(ladderAttempts(set)).toBe(1 * 2 * 3);
    expect(maxLadderCostUsd(set)).toBeCloseTo(6 * 0.5 + 6 * 0.5);
  });

  it("reads a run or an attempt written before the ladder existed, and never improves from a search", () => {
    const old = { id: "r", skill: "s", status: "done", startedAt: 1, finishedAt: 2, model: "haiku", repeats: 1, skillText: "", skillHash: "h" };
    const oldAttempt = { caseId: "u", arm: "with", round: 0, pass: true, skillInvoked: true, costUsd: 0, gradingCostUsd: 0, durationMs: 0 };
    const parsed = skillEvalRunSchema.parse({
      ...old,
      ...{ setHash: "s", cases: [useCase], plannedAttempts: 1 },
      attempts: [{ ...oldAttempt, finalText: "", checkOutput: "", denied: [], error: null }],
    });
    expect(parsed.ladder).toEqual([]);
    expect(parsed.attempts[0]?.model).toBe("");
    expect(isBaselineFor(parsed, "s", "h")).toBe(true);
    expect(isBaselineFor({ ...parsed, ladder: LADDER }, "s", "h")).toBe(false);
  });
});
