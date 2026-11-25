// Whether a measured improvement beats the measurement it was written from (#3529), by the rule the
// summary holds with against without to: a gap in the with-skill pass rate counts only when it is wider
// than the with-skill rounds of either run disagree, and at least one task's worth. Picking the better of
// two noisy numbers otherwise reads chance as progress. Pure.
import type { SkillEvalAttempt, SkillEvalCase } from "./skillEval.js";
import { oneCaseWorth, roundSpread, verdictOf } from "./skillEvalSummary.js";

export type SkillEvalChange = "better" | "worse" | "no-evidence" | "pending";

export interface MeasuredSkill {
  cases: readonly SkillEvalCase[];
  attempts: readonly SkillEvalAttempt[];
  repeats: number;
}

export interface SkillEvalComparison {
  change: SkillEvalChange;
  gap: number | null;
  spread: number | null;
  /** The tasks the improvement passed less often, avoid tasks included: the ids, in the tasks' order. */
  worseCaseIds: string[];
}

const CHANGE = { helps: "better", hurts: "worse", "no-evidence": "no-evidence", pending: "pending" } as const;

/** With the skill, a use task counts only when the skill ran, and an avoid task only when it did not. */
const countsFor =
  (kind: SkillEvalCase["kind"]) =>
  (attempt: SkillEvalAttempt): boolean =>
    attempt.pass && attempt.skillInvoked === (kind === "use");

const passRate = (attempts: readonly SkillEvalAttempt[], counts: (a: SkillEvalAttempt) => boolean): number | null =>
  attempts.length === 0 ? null : attempts.filter(counts).length / attempts.length;

const withSkillOn = (measured: MeasuredSkill, caseIds: ReadonlySet<string>): SkillEvalAttempt[] =>
  measured.attempts.filter((attempt) => attempt.arm === "with" && caseIds.has(attempt.caseId));

function spreadOf(measured: MeasuredSkill, useWith: readonly SkillEvalAttempt[]): number | null {
  // A single round cannot disagree with itself, as in the summary.
  if (measured.repeats < 2 && useWith.length > 0) return 0;
  return roundSpread(useWith, countsFor("use"));
}

function widerSpread(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : Math.max(a, b);
}

function worseCaseIds(baseline: MeasuredSkill, improvement: MeasuredSkill): string[] {
  return sharedCases(baseline, improvement)
    .filter((evalCase) => {
      const ids = new Set([evalCase.id]);
      const before = passRate(withSkillOn(baseline, ids), countsFor(evalCase.kind));
      const after = passRate(withSkillOn(improvement, ids), countsFor(evalCase.kind));
      return before !== null && after !== null && after < before;
    })
    .map((evalCase) => evalCase.id);
}

/** The tasks of `kind` both runs have with that kind: a task one of them lacks has nothing to be compared with. */
function sharedCases(baseline: MeasuredSkill, improvement: MeasuredSkill, kind?: SkillEvalCase["kind"]): SkillEvalCase[] {
  const baselineKind = new Map(baseline.cases.map((evalCase) => [evalCase.id, evalCase.kind]));
  return improvement.cases.filter((evalCase) => baselineKind.get(evalCase.id) === evalCase.kind && (kind === undefined || evalCase.kind === kind));
}

export function compareImprovement(baseline: MeasuredSkill, improvement: MeasuredSkill): SkillEvalComparison {
  const useIds = new Set(sharedCases(baseline, improvement, "use").map((evalCase) => evalCase.id));
  const before = withSkillOn(baseline, useIds);
  const after = withSkillOn(improvement, useIds);
  const beforeRate = passRate(before, countsFor("use"));
  const afterRate = passRate(after, countsFor("use"));
  const gap = beforeRate === null || afterRate === null ? null : afterRate - beforeRate;
  const spread = widerSpread(spreadOf(baseline, before), spreadOf(improvement, after));
  return {
    change: CHANGE[verdictOf(gap, spread, oneCaseWorth(useIds.size))],
    gap,
    spread,
    worseCaseIds: worseCaseIds(baseline, improvement),
  };
}
