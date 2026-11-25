// A skill evaluation (#3438): the set of cases a user approved, and the record of one run over it.
// Shared because the server runs and stores them and the Skills viewer shows them.
import { z } from "zod";
import type { BundledSkillName } from "./bundledSkills.js";

export const SKILL_EVAL_SET_VERSION = 1;
export const SKILL_EVAL_CASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SKILL_EVAL_DEFAULT_REPEATS = 3;
export const SKILL_EVAL_MAX_REPEATS = 5;
export const SKILL_EVAL_MAX_CASES = 20;
export const SKILL_EVAL_DEFAULT_MODEL = "haiku";
export const SKILL_EVAL_DEFAULT_BUDGET_USD = 0.5;
/** What one grading of a rubric case may spend. */
export const SKILL_EVAL_JUDGE_BUDGET_USD = 0.5;
/** What writing one improvement may spend (#3448). */
export const SKILL_EVAL_IMPROVE_BUDGET_USD = 1;
/** Writing an improvement takes judgement about a whole skill: a stronger model than the runs use. */
export const SKILL_EVAL_DEFAULT_IMPROVE_MODEL = "sonnet";
/** The models a search for the cheapest one that is enough climbs through, cheapest first (#3453). */
export const SKILL_EVAL_DEFAULT_LADDER = ["haiku", "sonnet", "opus"];
export const SKILL_EVAL_MAX_LADDER = 5;

const commandCheckSchema = z.object({ type: z.literal("command"), command: z.string().min(1) });
const rubricCheckSchema = z.object({ type: z.literal("rubric"), items: z.array(z.string().min(1)).min(1) });

export const skillEvalCaseSchema = z.object({
  id: z.string().regex(SKILL_EVAL_CASE_ID_RE),
  title: z.string().min(1),
  /** "use": the skill should help. "avoid": the skill should NOT be used. */
  kind: z.enum(["use", "avoid"]),
  prompt: z.string().min(1),
  check: z.discriminatedUnion("type", [commandCheckSchema, rubricCheckSchema]),
});

export const skillEvalSetSchema = z.object({
  version: z.literal(SKILL_EVAL_SET_VERSION),
  /** The name claude runs the skill by: `plugin:slug` or the slug. */
  skill: z.string().min(1),
  model: z.string().min(1).default(SKILL_EVAL_DEFAULT_MODEL),
  /** The model that grades a rubric case. */
  judgeModel: z.string().min(1).default(SKILL_EVAL_DEFAULT_MODEL),
  /** The model that writes an improved SKILL.md (#3448). */
  improveModel: z.string().min(1).default(SKILL_EVAL_DEFAULT_IMPROVE_MODEL),
  /** Cheapest first: the search stops at the first that passes everything. */
  ladder: z
    .array(z.string().min(1))
    .min(1)
    .max(SKILL_EVAL_MAX_LADDER)
    .refine((models) => new Set(models).size === models.length, "ladder models must be unique")
    .default(SKILL_EVAL_DEFAULT_LADDER),
  repeats: z.number().int().min(1).max(SKILL_EVAL_MAX_REPEATS).default(SKILL_EVAL_DEFAULT_REPEATS),
  maxBudgetUsdPerAttempt: z.number().positive().max(10).default(SKILL_EVAL_DEFAULT_BUDGET_USD),
  /** Tools beyond file edits the agent may use without asking, in claude's `--allowedTools` form. */
  allowedTools: z.array(z.string().min(1)).default([]),
  cases: z
    .array(skillEvalCaseSchema)
    .min(1)
    .max(SKILL_EVAL_MAX_CASES)
    .refine((cases) => new Set(cases.map((c) => c.id)).size === cases.length, "case ids must be unique"),
});

export type SkillEvalCase = z.infer<typeof skillEvalCaseSchema>;
export type SkillEvalSet = z.infer<typeof skillEvalSetSchema>;

export const skillEvalArmSchema = z.enum(["with", "without"]);
export type SkillEvalArm = z.infer<typeof skillEvalArmSchema>;

export const skillEvalAttemptSchema = z.object({
  caseId: z.string(),
  arm: skillEvalArmSchema,
  /** Which repeat, from 0. */
  round: z.number().int().min(0),
  pass: z.boolean(),
  skillInvoked: z.boolean(),
  costUsd: z.number(),
  gradingCostUsd: z.number(),
  durationMs: z.number(),
  /** The agent's last message, cut short. */
  finalText: z.string(),
  /** What the check printed, or the grader's reasons, cut short. */
  checkOutput: z.string(),
  /** Tools the agent asked for and was refused. */
  denied: z.array(z.string()),
  error: z.string().nullable(),
  /** The model the agent ran on. */
  model: z.string().default(""),
  /** The run this attempt was copied from, when it was not run again (#3465): an improvement takes its
   *  runs without the skill from the measurement it was written from. Empty for an attempt run here. */
  reusedFrom: z.string().default(""),
});
export type SkillEvalAttempt = z.infer<typeof skillEvalAttemptSchema>;

export const skillEvalRunStatusSchema = z.enum(["running", "done", "stopped", "interrupted"]);
export type SkillEvalRunStatus = z.infer<typeof skillEvalRunStatusSchema>;

export const skillEvalRunSchema = z.object({
  id: z.string(),
  skill: z.string(),
  status: skillEvalRunStatusSchema,
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  model: z.string(),
  repeats: z.number().int().min(1),
  /** The SKILL.md that was measured, so a later run can be compared against the text it ran. */
  skillText: z.string(),
  skillHash: z.string(),
  setHash: z.string(),
  cases: z.array(skillEvalCaseSchema),
  plannedAttempts: z.number().int().min(0),
  attempts: z.array(skillEvalAttemptSchema),
  /** Set when this run measured an improvement rather than the skill on disk (#3448): its folder under
   *  `candidates/`. Its SKILL.md is `skillText`, empty while it is still being written. */
  candidateId: z.string().nullable().default(null),
  /** What the improvement changed, in the words of the model that wrote it. */
  note: z.string().default(""),
  improveCostUsd: z.number().default(0),
  /** The hash of the skill on disk an improvement was written from: adopting it over any other text would lose an edit. */
  baseSkillHash: z.string().default(""),
  /** The measurement an improvement was written from, and is compared with. */
  baseRunId: z.string().nullable().default(null),
  /** Set when this run searched for the cheapest model that is enough (#3453): the models, cheapest first. */
  ladder: z.array(z.string()).default([]),
  /** Why a run ended as interrupted, when something failed rather than the server stopping (#3458). */
  interruptedBy: z.string().default(""),
});
export type SkillEvalRun = z.infer<typeof skillEvalRunSchema>;

/** The directory name for a skill id: a plugin skill's `:` is not safe in every file system. */
export const skillEvalDirName = (skillId: string): string => skillId.replace(/:/g, "__");

/** How many attempts a set runs: each "use" case with and without the skill, each "avoid" case with it. */
export function plannedAttempts(set: Pick<SkillEvalSet, "cases" | "repeats">): number {
  return set.cases.reduce((sum, c) => sum + (c.kind === "use" ? 2 : 1) * set.repeats, 0);
}

/** How many attempts measuring an improvement runs: every case with the skill. The runs without it are
 *  the ones its measurement made (#3465). */
export const improveAttempts = (set: Pick<SkillEvalSet, "cases" | "repeats">): number => set.cases.length * set.repeats;

type RunCostInputs = Pick<SkillEvalSet, "cases" | "repeats" | "maxBudgetUsdPerAttempt">;

/** Every attempt and every rubric grading at its cap, when each case runs `armsOf` times a round. */
function maxCostUsdOf(set: RunCostInputs, armsOf: (evalCase: SkillEvalCase) => number): number {
  const runs = (cases: readonly SkillEvalCase[]): number => cases.reduce((n, c) => n + armsOf(c) * set.repeats, 0);
  const graded = runs(set.cases.filter((c) => c.check.type === "rubric"));
  return runs(set.cases) * set.maxBudgetUsdPerAttempt + graded * SKILL_EVAL_JUDGE_BUDGET_USD;
}

/** The most a run of this set can spend: every attempt and every rubric grading at its cap. */
export const maxRunCostUsd = (set: RunCostInputs): number => maxCostUsdOf(set, (c) => (c.kind === "use" ? 2 : 1));

type LadderCostInputs = Pick<SkillEvalSet, "cases" | "repeats" | "maxBudgetUsdPerAttempt" | "ladder">;

const useCases = (set: Pick<SkillEvalSet, "cases">): SkillEvalCase[] => set.cases.filter((c) => c.kind === "use");

/** The most attempts a search for the cheapest model makes: every "use" case with the skill, on every model. */
export const ladderAttempts = (set: Pick<SkillEvalSet, "cases" | "repeats" | "ladder">): number => useCases(set).length * set.repeats * set.ladder.length;

/** The most that search can spend, when no model passes everything and every step is measured. */
export function maxLadderCostUsd(set: LadderCostInputs): number {
  const graded = useCases(set).filter((c) => c.check.type === "rubric").length * set.repeats * set.ladder.length;
  return ladderAttempts(set) * set.maxBudgetUsdPerAttempt + graded * SKILL_EVAL_JUDGE_BUDGET_USD;
}

/** The most writing an improvement and measuring it can spend: with the skill only (#3465). */
export const maxImproveCostUsd = (set: RunCostInputs): number => SKILL_EVAL_IMPROVE_BUDGET_USD + maxCostUsdOf(set, () => 1);

/** The attempts a run made itself, apart from the ones it copied from another run. */
export const freshAttempts = (run: Pick<SkillEvalRun, "attempts">): SkillEvalAttempt[] => run.attempts.filter((attempt) => attempt.reusedFrom === "");

/** What the run itself spent: its own attempts, their grading, and writing the improvement. */
export function runSpentUsd(run: Pick<SkillEvalRun, "attempts" | "improveCostUsd">): number {
  return freshAttempts(run).reduce((total, attempt) => total + attempt.costUsd + attempt.gradingCostUsd, run.improveCostUsd);
}

/** What a run measures: the skill with and without, an improvement written from its last measurement (#3448),
 *  or the cheapest model that is enough for it (#3453). */
export type SkillEvalRunMode = "measure" | "improve" | "ladder";

/** The bundled skill that drafts a set with the user. */
export const SKILL_EVAL_AUTHOR_SKILL: BundledSkillName = "mulmoterminal-skill-eval";

/** What `GET /api/skill-evals` answers for one skill. */
export const skillEvalOverviewSchema = z.object({
  skill: z.string(),
  /** Where its set and runs are kept. */
  dir: z.string(),
  set: skillEvalSetSchema.nullable(),
  /** The hash of the set's file as it is now, to tell which runs measured these tasks. */
  setHash: z.string().nullable(),
  setError: z.string().nullable(),
  estimate: z
    .object({
      ...{ attempts: z.number(), maxCostUsd: z.number(), improveAttempts: z.number(), maxImproveCostUsd: z.number() },
      ...{ ladderAttempts: z.number(), maxLadderCostUsd: z.number() },
    })
    .nullable(),
  /** Whether an improvement may be written over this skill's SKILL.md: not a plugin's or a bundled one. */
  editable: z.boolean(),
  /** The run the next improvement would be written from: the newest that `isBaselineFor` accepts, among all runs. */
  baseline: skillEvalRunSchema.nullable(),
  /** The newest first. */
  runs: z.array(skillEvalRunSchema),
  activeRunId: z.string().nullable(),
});
export type SkillEvalOverview = z.infer<typeof skillEvalOverviewSchema>;

/** Whether an improvement may be written from `run` (#3448): a finished measurement of the skill as its text is now,
 *  on the current set — its report would otherwise describe some other skill or tasks. A measured improvement
 *  counts once it is adopted (#3472): it measured exactly the SKILL.md that adopting wrote. */
export function isBaselineFor(run: SkillEvalRun, setHash: string, skillHash: string): boolean {
  // A search for the cheapest model measured no run without the skill, so its report has half the story.
  return run.ladder.length === 0 && run.status === "done" && run.attempts.length > 0 && run.setHash === setHash && run.skillHash === skillHash;
}
