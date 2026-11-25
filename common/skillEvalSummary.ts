// What a skill evaluation's attempts add up to (#3438), by the protocol in
// https://singularitysociety.org/articles/blog/2026-11-23-model-or-skill/ : pass/fail only, a pass
// with the skill counts only when the skill was invoked, the gap is held against how much the
// no-skill rounds disagree with each other, and cost is per pass with the failures included. Pure.
import type { SkillEvalArm, SkillEvalAttempt, SkillEvalCase } from "./skillEval.js";

/** Below this many "use" cases a small gap cannot be seen; the summary says so. */
export const SKILL_EVAL_FEW_CASES = 20;

export type SkillEvalVerdict = "helps" | "hurts" | "no-evidence" | "pending";

export interface SkillEvalArmSummary {
  attempts: number;
  passes: number;
  costUsd: number;
  /** Null when nothing passed: there is no cost per pass to give. */
  costPerPassUsd: number | null;
  passRate: number | null;
}

export interface SkillEvalSummary {
  with: SkillEvalArmSummary;
  without: SkillEvalArmSummary;
  /** Passes with the skill where it was never invoked: not counted, shown apart. */
  passesWithoutInvoking: number;
  /** Of the attempts with the skill on "use" cases, the share that invoked it. */
  invokeRate: number | null;
  /** The no-skill pass rate's range across rounds. */
  spread: number | null;
  gap: number | null;
  verdict: SkillEvalVerdict;
  fewCases: boolean;
  /** Use tasks every attempt passed in both arms, the skill read each time: they cannot show what it does. */
  passesEitherWay: string[];
  avoid: { attempts: number; invoked: number; passes: number; costUsd: number };
  gradingCostUsd: number;
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

function armSummary(attempts: readonly SkillEvalAttempt[], counts: (a: SkillEvalAttempt) => boolean): SkillEvalArmSummary {
  const passes = attempts.filter(counts).length;
  const costUsd = sum(attempts.map((a) => a.costUsd));
  return {
    attempts: attempts.length,
    passes,
    costUsd,
    costPerPassUsd: passes === 0 ? null : costUsd / passes,
    passRate: attempts.length === 0 ? null : passes / attempts.length,
  };
}

/** The no-skill pass rate of each round, and the distance between the highest and the lowest. */
function roundSpread(without: readonly SkillEvalAttempt[]): number | null {
  const rounds = [...new Set(without.map((a) => a.round))];
  if (rounds.length < 2) return null;
  const rates = rounds.map((round) => {
    const inRound = without.filter((a) => a.round === round);
    return inRound.filter((a) => a.pass).length / inRound.length;
  });
  return Math.max(...rates) - Math.min(...rates);
}

// Rates are fractions of whole attempts, so two that should be equal can differ in the last bits
// (0.6 - 0.4 is 0.19999999999999996): a gap within this of the threshold is AT the threshold.
const RATE_EPSILON = 1e-9;

function verdictOf(gap: number | null, spread: number | null, minimumGap: number): SkillEvalVerdict {
  if (gap === null || spread === null) return "pending";
  const size = Math.abs(gap);
  if (size <= spread + RATE_EPSILON || size < minimumGap - RATE_EPSILON) return "no-evidence";
  return gap > 0 ? "helps" : "hurts";
}

const ofArm = (attempts: readonly SkillEvalAttempt[], arm: SkillEvalArm): SkillEvalAttempt[] => attempts.filter((a) => a.arm === arm);

/** The no-skill attempts of an improvement are its baseline's, copied in: still that task without the skill. */
function passesEitherWay(
  cases: readonly SkillEvalCase[],
  useWith: readonly SkillEvalAttempt[],
  useWithout: readonly SkillEvalAttempt[],
  repeats: number,
): string[] {
  // Every round, not only the ones that ran: a stopped run has not shown "every time" yet.
  const allPass = (attempts: readonly SkillEvalAttempt[], counts: (a: SkillEvalAttempt) => boolean): boolean =>
    attempts.length > 0 && attempts.length >= repeats && attempts.every(counts);
  return cases
    .filter((c) => c.kind === "use")
    .filter((c) => {
      const ofCase = (attempts: readonly SkillEvalAttempt[]) => attempts.filter((a) => a.caseId === c.id);
      return allPass(ofCase(useWith), (a) => a.pass && a.skillInvoked) && allPass(ofCase(useWithout), (a) => a.pass);
    })
    .map((c) => c.id);
}

function avoidSummary(avoid: readonly SkillEvalAttempt[]): SkillEvalSummary["avoid"] {
  return {
    ...{ attempts: avoid.length, invoked: avoid.filter((a) => a.skillInvoked).length, passes: avoid.filter((a) => a.pass && !a.skillInvoked).length },
    costUsd: sum(avoid.map((a) => a.costUsd)),
  };
}

export function summarizeSkillEval(cases: readonly SkillEvalCase[], attempts: readonly SkillEvalAttempt[], repeats: number): SkillEvalSummary {
  const kindOf = new Map(cases.map((c) => [c.id, c.kind]));
  const useWith = ofArm(attempts, "with").filter((a) => kindOf.get(a.caseId) === "use");
  const useWithout = ofArm(attempts, "without").filter((a) => kindOf.get(a.caseId) === "use");
  const withSkill = armSummary(useWith, (a) => a.pass && a.skillInvoked);
  const withoutSkill = armSummary(useWithout, (a) => a.pass);
  const useCases = cases.filter((c) => c.kind === "use").length;
  const gap = withSkill.passRate === null || withoutSkill.passRate === null ? null : withSkill.passRate - withoutSkill.passRate;
  // A single round cannot disagree with itself, so there is nothing to hold the gap against.
  const spread = repeats < 2 && useWithout.length > 0 ? 0 : roundSpread(useWithout);
  // One case's worth: every repeat of one case flipping. A smaller gap is a coin landing differently.
  const minimumGap = useCases === 0 ? 1 : 1 / useCases;
  return {
    with: withSkill,
    without: withoutSkill,
    passesWithoutInvoking: useWith.filter((a) => a.pass && !a.skillInvoked).length,
    invokeRate: useWith.length === 0 ? null : useWith.filter((a) => a.skillInvoked).length / useWith.length,
    spread,
    gap,
    verdict: verdictOf(gap, spread, minimumGap),
    fewCases: useCases < SKILL_EVAL_FEW_CASES,
    passesEitherWay: passesEitherWay(cases, useWith, useWithout, repeats),
    avoid: avoidSummary(ofArm(attempts, "with").filter((a) => kindOf.get(a.caseId) === "avoid")),
    gradingCostUsd: sum(attempts.map((a) => a.gradingCostUsd)),
  };
}
