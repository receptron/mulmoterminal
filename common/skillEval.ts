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
});
export type SkillEvalRun = z.infer<typeof skillEvalRunSchema>;

/** The directory name for a skill id: a plugin skill's `:` is not safe in every file system. */
export const skillEvalDirName = (skillId: string): string => skillId.replace(/:/g, "__");

/** How many attempts a set runs: each "use" case with and without the skill, each "avoid" case with it. */
export function plannedAttempts(set: Pick<SkillEvalSet, "cases" | "repeats">): number {
  return set.cases.reduce((sum, c) => sum + (c.kind === "use" ? 2 : 1) * set.repeats, 0);
}

/** The most a run of this set can spend: every attempt and every rubric grading at its cap. */
export function maxRunCostUsd(set: Pick<SkillEvalSet, "cases" | "repeats" | "maxBudgetUsdPerAttempt">): number {
  const graded = set.cases.filter((c) => c.check.type === "rubric").reduce((n, c) => n + (c.kind === "use" ? 2 : 1) * set.repeats, 0);
  return plannedAttempts(set) * set.maxBudgetUsdPerAttempt + graded * SKILL_EVAL_JUDGE_BUDGET_USD;
}

/** The most writing an improvement and measuring it can spend. */
export const maxImproveCostUsd = (set: Pick<SkillEvalSet, "cases" | "repeats" | "maxBudgetUsdPerAttempt">): number =>
  SKILL_EVAL_IMPROVE_BUDGET_USD + maxRunCostUsd(set);

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
  estimate: z.object({ attempts: z.number(), maxCostUsd: z.number(), maxImproveCostUsd: z.number() }).nullable(),
  /** Whether an improvement may be written over this skill's SKILL.md: not a plugin's or a bundled one. */
  editable: z.boolean(),
  /** The newest first. */
  runs: z.array(skillEvalRunSchema),
  activeRunId: z.string().nullable(),
});
export type SkillEvalOverview = z.infer<typeof skillEvalOverviewSchema>;

/** The run an improvement is written from (#3448): the newest finished measurement of the skill itself
 *  on the current set — not an improvement's run, and not one made with tasks that have since changed. */
export function latestBaseline(runs: readonly SkillEvalRun[], setHash: string): SkillEvalRun | null {
  return runs.find((run) => run.candidateId === null && run.status === "done" && run.attempts.length > 0 && run.setHash === setHash) ?? null;
}
