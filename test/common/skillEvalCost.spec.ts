// @vitest-environment node
// What a skill evaluation may and did spend (#3465): an improvement is measured with the skill only, and
// a run's own spend leaves out the attempts it copied from another run.
import { describe, it, expect } from "vitest";
import {
  improveAttempts,
  maxImproveCostUsd,
  maxRunCostUsd,
  plannedAttempts,
  runSpentUsd,
  freshAttempts,
  SKILL_EVAL_IMPROVE_BUDGET_USD,
  SKILL_EVAL_JUDGE_BUDGET_USD,
  type SkillEvalAttempt,
  type SkillEvalCase,
} from "../../common/skillEval";

const command: SkillEvalCase["check"] = { type: "command", command: "true" };
const rubric: SkillEvalCase["check"] = { type: "rubric", items: ["ok"] };
const evalCase = (id: string, kind: SkillEvalCase["kind"], check: SkillEvalCase["check"] = command): SkillEvalCase => ({
  id,
  title: id,
  kind,
  prompt: "p",
  check,
});
const setOf = (cases: SkillEvalCase[]) => ({ cases, repeats: 3, maxBudgetUsdPerAttempt: 0.5 });

const attempt = (costUsd: number, gradingCostUsd: number, reusedFrom = ""): SkillEvalAttempt => ({
  ...{ caseId: "a", arm: "without", round: 0, pass: true, skillInvoked: false, costUsd, gradingCostUsd, durationMs: 0 },
  ...{ finalText: "", checkOutput: "", denied: [], error: null, model: "haiku", reusedFrom },
});

describe("what measuring an improvement may spend", () => {
  it("runs every case once a round with the skill, and none without it", () => {
    const set = setOf([evalCase("a", "use"), evalCase("b", "use"), evalCase("c", "avoid")]);
    expect(improveAttempts(set)).toBe(9);
    expect(plannedAttempts(set) - improveAttempts(set)).toBe(6);
    expect(maxImproveCostUsd(set)).toBeCloseTo(SKILL_EVAL_IMPROVE_BUDGET_USD + 9 * 0.5);
  });

  it("caps the grading of a rubric case once a round, against twice for a measurement", () => {
    const set = setOf([evalCase("a", "use", rubric)]);
    expect(maxImproveCostUsd(set)).toBeCloseTo(SKILL_EVAL_IMPROVE_BUDGET_USD + 3 * (0.5 + SKILL_EVAL_JUDGE_BUDGET_USD));
    expect(maxRunCostUsd(set)).toBeCloseTo(6 * (0.5 + SKILL_EVAL_JUDGE_BUDGET_USD));
  });

  it("is only the writer's budget for a set with no cases", () => {
    expect(improveAttempts(setOf([]))).toBe(0);
    expect(maxImproveCostUsd(setOf([]))).toBe(SKILL_EVAL_IMPROVE_BUDGET_USD);
  });
});

describe("what a run spent", () => {
  it("counts its own attempts, their grading and the improvement, but not what it copied", () => {
    const attempts = [attempt(0.1, 0.05), attempt(0.4, 0.2, "older-run")];
    expect(freshAttempts({ attempts })).toEqual([attempts[0]]);
    expect(runSpentUsd({ attempts, improveCostUsd: 0.3 })).toBeCloseTo(0.45);
  });

  it("is the improvement alone when nothing ran, and nothing for an empty run", () => {
    expect(runSpentUsd({ attempts: [attempt(1, 1, "r")], improveCostUsd: 0.3 })).toBeCloseTo(0.3);
    expect(runSpentUsd({ attempts: [], improveCostUsd: 0 })).toBe(0);
  });
});
