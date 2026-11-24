// What a search for the cheapest model that is enough found (#3453), by the rule in
// https://singularitysociety.org/articles/blog/2026-11-23-model-or-skill/ : the cheapest model that passes
// as often as the best one did. A pass counts only when the skill was read, as in the with/without
// summary. Pure.
import type { SkillEvalAttempt } from "./skillEval.js";

export interface SkillEvalLadderStep {
  model: string;
  /** False for a model above one that passed everything: the search stopped before it. */
  measured: boolean;
  attempts: number;
  passes: number;
  passRate: number | null;
  /** The agent runs on this model, failures included; grading is apart. */
  costUsd: number;
  costPerPassUsd: number | null;
}

export interface SkillEvalLadderSummary {
  steps: SkillEvalLadderStep[];
  /** The cheapest model that passed as often as the best one; null when none passed, or the search did not finish. */
  enough: string | null;
  /** The search ran to its end: a stopped or interrupted one measured a step only in part, so it names no model. */
  finished: boolean;
  /** Only one model passed anything: the choice rests on that one row. */
  shaky: boolean;
  gradingCostUsd: number;
}

const counts = (attempt: SkillEvalAttempt): boolean => attempt.pass && attempt.skillInvoked;
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

function stepOf(model: string, attempts: readonly SkillEvalAttempt[]): SkillEvalLadderStep {
  const passes = attempts.filter(counts).length;
  const costUsd = sum(attempts.map((a) => a.costUsd));
  return {
    ...{ model, measured: attempts.length > 0, attempts: attempts.length, passes },
    ...{ passRate: attempts.length === 0 ? null : passes / attempts.length, costUsd, costPerPassUsd: passes === 0 ? null : costUsd / passes },
  };
}

/** Whether one model's step passed every attempt it was planned to make: nothing above it can pass more. */
export function ladderStepPassedAll(stepAttempts: readonly SkillEvalAttempt[], planned: number): boolean {
  return planned > 0 && stepAttempts.length === planned && stepAttempts.every(counts);
}

export function summarizeLadder(ladder: readonly string[], attempts: readonly SkillEvalAttempt[], finished: boolean): SkillEvalLadderSummary {
  const steps = ladder.map((model) =>
    stepOf(
      model,
      attempts.filter((a) => a.model === model),
    ),
  );
  const best = Math.max(0, ...steps.map((step) => step.passes));
  const enough = !finished || best === 0 ? null : (steps.find((step) => step.passes === best)?.model ?? null);
  return {
    steps,
    enough,
    finished,
    // A search that stopped at its first model is not shaky: nothing cheaper exists to compare it with.
    shaky: steps.filter((step) => step.measured).length > 1 && steps.filter((step) => step.passes > 0).length === 1,
    gradingCostUsd: sum(attempts.map((a) => a.gradingCostUsd)),
  };
}
