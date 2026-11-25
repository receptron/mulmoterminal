// One attempt of a skill evaluation (#3438): a fresh directory with the case's files (and, with the
// skill, a copy of the skill), one agent run, then its grading. The directory is removed afterwards;
// what is kept is the record.
import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { SkillEvalArm, SkillEvalAttempt, SkillEvalCase, SkillEvalSet } from "../../../common/skillEval.js";
import { SKILL_EVAL_JUDGE_BUDGET_USD } from "../../../common/skillEval.js";
import { isRecord } from "../../../common/isRecord.js";
import { runCheck, type CheckResult } from "../../blueprint/checkRunner.js";
import { agentArgs, agentPrompt, judgeArgs, judgePrompt } from "./evalArgs.js";
import { streamOutcome, type StreamOutcome } from "./streamOutcome.js";
import type { RunClaude } from "./runClaude.js";

/** An agent run that has not finished by then is killed and counted as a failure. */
export const ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000;
const CHECK_TIMEOUT_MS = 2 * 60 * 1000;
const KEPT_TEXT_CHARS = 2000;

export interface AttemptDeps {
  claudeBin: string;
  runClaude: RunClaude;
  runCommand: (command: string, cwd: string) => Promise<CheckResult>;
  /** Where the attempt directories are made. Outside any project, so no CLAUDE.md above it is read. */
  tmpRoot: string;
  now: () => number;
}

export interface AttemptPlan {
  set: SkillEvalSet;
  evalCase: SkillEvalCase;
  arm: SkillEvalArm;
  round: number;
  /** The model the agent runs on: the set's own, or one step of a search for the cheapest (#3453). */
  model: string;
  skillDir: string;
  skillSlug: string;
  /** The case's starting files, when it has any. */
  filesDir: string;
}

export const commandRunner = (command: string, cwd: string): Promise<CheckResult> =>
  runCheck({ command, cwd, basePackDir: cwd, usecasePackDir: cwd }, CHECK_TIMEOUT_MS);

const keep = (text: string): string => (text.length > KEPT_TEXT_CHARS ? `${text.slice(0, KEPT_TEXT_CHARS)}…` : text);

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function prepareDir(plan: AttemptPlan, tmpRoot: string): Promise<string> {
  const work = await mkdtemp(path.join(tmpRoot, `${plan.evalCase.id}-${plan.arm}-`));
  if (await exists(plan.filesDir)) await cp(plan.filesDir, work, { recursive: true });
  if (plan.arm === "with") await cp(plan.skillDir, path.join(work, ".claude", "skills", plan.skillSlug), { recursive: true });
  return work;
}

async function runAgent(plan: AttemptPlan, work: string, deps: AttemptDeps): Promise<StreamOutcome> {
  const ran = await deps.runClaude({
    bin: deps.claudeBin,
    args: agentArgs(plan.model, plan.set.maxBudgetUsdPerAttempt, plan.set.allowedTools),
    prompt: agentPrompt(plan.evalCase, plan.arm, plan.skillSlug),
    cwd: work,
    timeoutMs: ATTEMPT_TIMEOUT_MS,
  });
  const outcome = streamOutcome(ran.stdout.split("\n"), plan.skillSlug);
  return ran.failure === null ? outcome : { ...outcome, error: ran.failure };
}

interface Grade {
  pass: boolean;
  output: string;
  costUsd: number;
}

/** The grader's `{ pass, reasons }`, or a failed grade when it answered anything else. */
export function judgeGrade(stdout: string): Grade {
  try {
    const value: unknown = JSON.parse(stdout);
    if (!isRecord(value)) throw new Error("not an object");
    const costUsd = typeof value.total_cost_usd === "number" ? value.total_cost_usd : 0;
    const verdict = value.structured_output;
    if (!isRecord(verdict) || typeof verdict.pass !== "boolean") return { pass: false, output: "the grader gave no verdict", costUsd };
    const reasons = Array.isArray(verdict.reasons) ? verdict.reasons.filter((r): r is string => typeof r === "string") : [];
    return { pass: verdict.pass, output: reasons.join("\n"), costUsd };
  } catch {
    return { pass: false, output: "the grader's answer could not be read", costUsd: 0 };
  }
}

async function grade(plan: AttemptPlan, work: string, finalText: string, deps: AttemptDeps): Promise<Grade> {
  const { check } = plan.evalCase;
  if (check.type === "command") {
    const result = await deps.runCommand(check.command, work);
    return { pass: result.ok, output: result.output, costUsd: 0 };
  }
  const ran = await deps.runClaude({
    bin: deps.claudeBin,
    args: judgeArgs(plan.set.judgeModel, SKILL_EVAL_JUDGE_BUDGET_USD),
    prompt: judgePrompt(plan.evalCase, check.items, finalText),
    cwd: work,
    timeoutMs: ATTEMPT_TIMEOUT_MS,
  });
  return ran.failure === null ? judgeGrade(ran.stdout) : { pass: false, output: ran.failure, costUsd: 0 };
}

export async function runAttempt(plan: AttemptPlan, deps: AttemptDeps): Promise<SkillEvalAttempt> {
  const startedAt = deps.now();
  const work = await prepareDir(plan, deps.tmpRoot);
  try {
    const outcome = await runAgent(plan, work, deps);
    // The grader must judge the work, not read the skill being measured and grade by it.
    await rm(path.join(work, ".claude", "skills"), { recursive: true, force: true });
    // A run that ended in an error is a failure whatever is on disk: it did not finish the task.
    const graded = outcome.error === null ? await grade(plan, work, outcome.finalText, deps) : { pass: false, output: "", costUsd: 0 };
    return {
      ...{ caseId: plan.evalCase.id, arm: plan.arm, round: plan.round, pass: graded.pass, skillInvoked: outcome.skillInvoked },
      ...{ costUsd: outcome.costUsd, gradingCostUsd: graded.costUsd, durationMs: deps.now() - startedAt },
      ...{
        finalText: keep(outcome.finalText),
        checkOutput: keep(graded.output),
        denied: outcome.denied,
        error: outcome.error,
        model: plan.model,
        reusedFrom: "",
      },
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
