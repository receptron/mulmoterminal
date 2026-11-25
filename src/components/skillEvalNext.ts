// The one step the skill evaluation panel points at (#3466): what to press next, from what has been
// measured so far, so someone new to it is not left choosing among four buttons of equal weight. Pure.
import type { SkillEvalOverview, SkillEvalRun } from "../../common/skillEval";
import { summarizeSkillEval } from "../../common/skillEvalSummary";
import { compareImprovement } from "../../common/skillEvalCompare";

export type SkillEvalStep = "draft" | "measure" | "improve" | "adopt" | "ladder";

/** Why the step is the next one; `done` when there is nothing more to measure until the skill changes. Drafting
 *  needs none: it is the only thing offered before there are tasks, and the panel already says what it is. */
export type SkillEvalNextReason = Exclude<SkillEvalStep, "draft"> | "improveAgain" | "done";

export interface SkillEvalNext {
  step: SkillEvalStep | null;
  reason: SkillEvalNextReason | null;
}

const NOTHING: SkillEvalNext = { step: null, reason: null };
const next = (step: Exclude<SkillEvalStep, "draft">, reason: SkillEvalNextReason = step): SkillEvalNext => ({ step, reason });

/** The improvements written from `baseline`, finished on the same tasks, the newest first. */
const improvementsOf = (overview: SkillEvalOverview, baseline: SkillEvalRun): SkillEvalRun[] =>
  overview.runs.filter((run) => run.baseRunId === baseline.id && run.status === "done" && run.skillText !== "" && run.setHash === overview.setHash);

/** A search for the cheapest model already finished for the skill and tasks as they are now. */
const searched = (overview: SkillEvalOverview, baseline: SkillEvalRun): boolean =>
  overview.runs.some((run) => run.ladder.length > 0 && run.status === "done" && run.skillHash === baseline.skillHash && run.setHash === baseline.setHash);

function afterHelping(overview: SkillEvalOverview, baseline: SkillEvalRun): SkillEvalNext {
  if (searched(overview, baseline)) return { step: null, reason: "done" };
  return (overview.estimate?.ladderAttempts ?? 0) > 0 ? next("ladder") : NOTHING;
}

/** The improvement on screen — the newest run — when it was written from `baseline` and passes more than chance would. */
function betterImprovement(overview: SkillEvalOverview, baseline: SkillEvalRun): boolean {
  const [newest] = overview.runs;
  return newest !== undefined && improvementsOf(overview, baseline).includes(newest) && compareImprovement(baseline, newest).change === "better";
}

function afterNotHelping(overview: SkillEvalOverview, baseline: SkillEvalRun): SkillEvalNext {
  return improvementsOf(overview, baseline).length === 0 ? next("improve") : next("improve", "improveAgain");
}

export function skillEvalNext(overview: SkillEvalOverview): SkillEvalNext {
  if (overview.set === null) return { step: "draft", reason: null };
  if (overview.activeRunId !== null) return NOTHING;
  const { baseline } = overview;
  if (baseline === null) return next("measure");
  if (overview.editable && betterImprovement(overview, baseline)) return next("adopt");
  const { verdict } = summarizeSkillEval(baseline.cases, baseline.attempts, baseline.repeats);
  if (verdict === "helps") return afterHelping(overview, baseline);
  if (verdict === "pending" || !overview.editable) return NOTHING;
  return afterNotHelping(overview, baseline);
}
