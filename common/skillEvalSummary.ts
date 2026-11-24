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
  avoid: { attempts: number; invoked: number; passes: number };
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

function verdictOf(gap: number | null, spread: number | null, minimumGap: number): SkillEvalVerdict {
  if (gap === null || spread === null) return "pending";
  if (Math.abs(gap) <= spread || Math.abs(gap) < minimumGap) return "no-evidence";
  return gap > 0 ? "helps" : "hurts";
}

const ofArm = (attempts: readonly SkillEvalAttempt[], arm: SkillEvalArm): SkillEvalAttempt[] => attempts.filter((a) => a.arm === arm);

function avoidSummary(avoid: readonly SkillEvalAttempt[]): SkillEvalSummary["avoid"] {
  return { attempts: avoid.length, invoked: avoid.filter((a) => a.skillInvoked).length, passes: avoid.filter((a) => a.pass && !a.skillInvoked).length };
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
    avoid: avoidSummary(ofArm(attempts, "with").filter((a) => kindOf.get(a.caseId) === "avoid")),
    gradingCostUsd: sum(attempts.map((a) => a.gradingCostUsd)),
  };
}
