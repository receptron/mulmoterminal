// What a skill evaluation's attempts add up to (#3438): the verdict against the no-skill rounds'
// spread, passes that never invoked the skill, cost per pass with failures in, and the avoid case.
import { describe, it, expect } from "vitest";
import { summarizeSkillEval } from "../../common/skillEvalSummary";
import { maxRunCostUsd, plannedAttempts, skillEvalSetSchema, type SkillEvalAttempt, type SkillEvalCase } from "../../common/skillEval";

const useCase = (id: string): SkillEvalCase => ({ id, title: id, kind: "use", prompt: "p", check: { type: "command", command: "true" } });
const avoidCase: SkillEvalCase = { id: "avoid", title: "avoid", kind: "avoid", prompt: "p", check: { type: "rubric", items: ["x"] } };

function attempt(caseId: string, arm: "with" | "without", round: number, pass: boolean, extra: Partial<SkillEvalAttempt> = {}): SkillEvalAttempt {
  return {
    ...{ caseId, arm, round, pass, skillInvoked: arm === "with", costUsd: 1, gradingCostUsd: 0, durationMs: 0 },
    ...{ finalText: "", checkOutput: "", denied: [], error: null },
    ...extra,
  };
}

/** Every case and round, passing as `passes(arm, caseIndex, round)` says. */
function grid(cases: SkillEvalCase[], repeats: number, passes: (arm: "with" | "without", c: number, round: number) => boolean): SkillEvalAttempt[] {
  return cases.flatMap((c, i) =>
    Array.from({ length: repeats }, (_, round) => round).flatMap((round) => [
      attempt(c.id, "with", round, passes("with", i, round)),
      attempt(c.id, "without", round, passes("without", i, round)),
    ]),
  );
}

const five = ["a", "b", "c", "d", "e"].map(useCase);

describe("summarizeSkillEval", () => {
  it("says the skill helps when the gap is wider than the no-skill rounds disagree", () => {
    const summary = summarizeSkillEval(
      five,
      grid(five, 3, (arm, c) => arm === "with" || c === 0),
      3,
    );
    expect(summary.with.passRate).toBe(1);
    expect(summary.without.passRate).toBeCloseTo(0.2);
    expect(summary.spread).toBe(0);
    expect(summary.verdict).toBe("helps");
  });

  it("says it hurts when the gap is as wide the other way", () => {
    expect(
      summarizeSkillEval(
        five,
        grid(five, 3, (arm) => arm === "without"),
        3,
      ).verdict,
    ).toBe("hurts");
  });

  it("finds no evidence when the gap is within the spread of the no-skill rounds", () => {
    // Without: round 0 passes all five, rounds 1 and 2 pass none — a spread of 1.
    const summary = summarizeSkillEval(
      five,
      grid(five, 3, (arm, _c, round) => arm === "with" || round === 0),
      3,
    );
    expect(summary.spread).toBe(1);
    expect(summary.verdict).toBe("no-evidence");
  });

  it("finds no evidence in a gap smaller than one case's worth, even with no spread", () => {
    // One attempt of one case differs: 1/15 of the attempts, under the 1/5 a whole case would be.
    const summary = summarizeSkillEval(
      five,
      grid(five, 3, (arm, c, round) => arm === "without" || (c === 0 && round === 0) || c > 0),
      3,
    );
    expect(summary.spread).toBe(0);
    expect(summary.verdict).toBe("no-evidence");
  });

  it("does not count a pass with the skill that never invoked it", () => {
    const attempts = [attempt("a", "with", 0, true, { skillInvoked: false }), attempt("a", "without", 0, false)];
    const summary = summarizeSkillEval([useCase("a")], attempts, 1);
    expect(summary.with.passes).toBe(0);
    expect(summary.passesWithoutInvoking).toBe(1);
    expect(summary.invokeRate).toBe(0);
  });

  it("prices a pass with every failure's cost included, and gives none when nothing passed", () => {
    const attempts = [attempt("a", "with", 0, true), attempt("a", "with", 1, false), attempt("a", "without", 0, false), attempt("a", "without", 1, false)];
    const summary = summarizeSkillEval([useCase("a")], attempts, 2);
    expect(summary.with.costPerPassUsd).toBe(2);
    expect(summary.without.costPerPassUsd).toBeNull();
  });

  it("is pending until both arms have finished an attempt", () => {
    expect(summarizeSkillEval(five, [], 3).verdict).toBe("pending");
    expect(summarizeSkillEval(five, [attempt("a", "with", 0, true)], 3).verdict).toBe("pending");
  });

  it("judges a single-round set without a spread to hold the gap against", () => {
    expect(
      summarizeSkillEval(
        five,
        grid(five, 1, (arm) => arm === "with"),
        1,
      ).verdict,
    ).toBe("helps");
  });

  it("counts the avoid case apart: a pass is one that passed the check without invoking the skill", () => {
    const attempts = [
      attempt("avoid", "with", 0, true, { skillInvoked: false }),
      attempt("avoid", "with", 1, true, { skillInvoked: true }),
      attempt("avoid", "with", 2, false, { skillInvoked: false }),
    ];
    const summary = summarizeSkillEval([useCase("a"), avoidCase], attempts, 3);
    expect(summary.avoid).toEqual({ attempts: 3, invoked: 1, passes: 1 });
    expect(summary.with.attempts).toBe(0);
  });

  it("says when there are too few cases to see a small gap", () => {
    expect(summarizeSkillEval(five, [], 3).fewCases).toBe(true);
  });
});

describe("the set's plan", () => {
  const set = skillEvalSetSchema.parse({ version: 1, skill: "s", cases: [useCase("a"), useCase("b"), avoidCase] });

  it("fills in the defaults", () => {
    expect(set).toMatchObject({ model: "haiku", judgeModel: "haiku", repeats: 3, maxBudgetUsdPerAttempt: 0.5, allowedTools: [] });
  });

  it("runs each use case in both arms and the avoid case with the skill only", () => {
    expect(plannedAttempts(set)).toBe((2 * 2 + 1) * 3);
  });

  it("caps the cost at every attempt and every rubric grading at its limit", () => {
    expect(maxRunCostUsd(set)).toBeCloseTo(15 * 0.5 + 3 * 0.5);
  });

  it("refuses duplicate case ids, a bad id and too many repeats", () => {
    expect(skillEvalSetSchema.safeParse({ version: 1, skill: "s", cases: [useCase("a"), useCase("a")] }).success).toBe(false);
    expect(skillEvalSetSchema.safeParse({ version: 1, skill: "s", cases: [useCase("A b")] }).success).toBe(false);
    expect(skillEvalSetSchema.safeParse({ version: 1, skill: "s", repeats: 9, cases: [useCase("a")] }).success).toBe(false);
    expect(skillEvalSetSchema.safeParse({ version: 1, skill: "s", cases: [] }).success).toBe(false);
  });
});
