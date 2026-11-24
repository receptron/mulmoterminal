// Writing an improved SKILL.md from a finished evaluation (#3448). One `claude -p` run in a fresh
// directory holds a copy of the skill and a report of how it did, and edits the copy; the result is
// kept under `candidates/<run id>/` and measured on the same cases. The skill on disk is never touched
// here — adopting an improvement is the user's call, after seeing it measured.
//
// The rules given to the writer are the ones the evaluation papers measured: short bodies beat long ones,
// fixed paths and templates override the task, an unread skill usually has a description that does not
// summarise its body, and a skill rewritten without a test can do worse than none — which is why the
// result is measured before anyone may adopt it.
import { cp, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SKILL_EVAL_IMPROVE_BUDGET_USD, type SkillEvalAttempt, type SkillEvalCase, type SkillEvalRun, type SkillEvalSet } from "../../../common/skillEval.js";
import { ATTEMPT_TIMEOUT_MS, type AttemptDeps } from "./evalAttempt.js";
import { improveArgs } from "./evalArgs.js";
import { streamOutcome } from "./streamOutcome.js";

const REPORT_FILE = "eval-report.md";
const SKILL_FOLDER = "skill";
const REPORT_TEXT_CHARS = 600;

export const candidateDir = (evalDir: string, runId: string): string => path.join(evalDir, "candidates", runId);

const clip = (text: string): string => (text.length > REPORT_TEXT_CHARS ? `${text.slice(0, REPORT_TEXT_CHARS)}…` : text);

function checkLine(evalCase: SkillEvalCase): string {
  return evalCase.check.type === "command" ? `command \`${evalCase.check.command}\`` : `every item holds: ${evalCase.check.items.join(" / ")}`;
}

function readNote(attempt: SkillEvalAttempt): string {
  if (attempt.arm === "without") return "";
  return attempt.skillInvoked ? ", skill read" : ", skill NOT read";
}

function attemptLine(attempt: SkillEvalAttempt): string {
  const why = attempt.pass ? "" : ` — ${clip(attempt.error ?? attempt.checkOutput)}`;
  return `- ${attempt.arm} skill, round ${String(attempt.round + 1)}: ${attempt.pass ? "pass" : "FAIL"}${readNote(attempt)}${why}`;
}

function caseSection(run: SkillEvalRun, evalCase: SkillEvalCase): string[] {
  const lines = run.attempts.filter((a) => a.caseId === evalCase.id).map(attemptLine);
  const kind = evalCase.kind === "use" ? "the skill should help" : "the skill should NOT be used";
  return [`### ${evalCase.title} (${kind})`, "", `Request: ${evalCase.prompt}`, `Pass when: ${checkLine(evalCase)}`, "", ...lines, ""];
}

/** How the skill did, case by case, as the writer reads it. Pure. */
export function improveReport(run: SkillEvalRun): string {
  return ["# How the skill did", "", ...run.cases.flatMap((evalCase) => caseSection(run, evalCase))].join("\n");
}

export function improvePrompt(): string {
  return [
    `Improve the Claude Code skill in ./${SKILL_FOLDER}/ by editing ./${SKILL_FOLDER}/SKILL.md in place. ./${REPORT_FILE} says how it did on small test tasks, with and without it.`,
    "",
    "Rules:",
    "- Fix the general cause of each failure. Do NOT mention, quote or special-case the test tasks: the skill must help on requests like them, not on these exact ones.",
    "- Keep the body short: the steps and how to tell the work is done. Remove explanation the task does not need. A shorter skill that passes is better than a longer one.",
    "- No hard-coded file paths, names or fill-in templates that would override what the user asks for.",
    "- Where the skill was NOT read, rewrite the frontmatter `description` as a two or three sentence summary of what the body does and when to use it.",
    "- Keep the frontmatter `name` unchanged. Change other files in the folder only if the report shows they are the cause.",
    "",
    "When you are done, reply with one short paragraph saying what you changed and why.",
  ].join("\n");
}

export interface Candidate {
  dir: string;
  skillText: string;
  note: string;
  costUsd: number;
}

export type CandidateResult = { kind: "ok"; candidate: Candidate } | { kind: "failed"; error: string; costUsd: number };

async function writeInputs(work: string, baseSkillDir: string, baseline: SkillEvalRun): Promise<void> {
  await cp(baseSkillDir, path.join(work, SKILL_FOLDER), { recursive: true });
  await writeFile(path.join(work, REPORT_FILE), improveReport(baseline));
}

async function keepCandidate(work: string, dir: string, before: string, note: string, costUsd: number): Promise<CandidateResult> {
  const skillText = await readFile(path.join(work, SKILL_FOLDER, "SKILL.md"), "utf8").catch(() => null);
  if (skillText === null) return { kind: "failed", error: "the improvement left no SKILL.md", costUsd };
  if (skillText === before) return { kind: "failed", error: "the improvement changed nothing", costUsd };
  // A link the writer made could point anywhere; the candidate keeps regular files only.
  try {
    await cp(path.join(work, SKILL_FOLDER), dir, { recursive: true, filter: async (source) => !(await lstat(source)).isSymbolicLink() });
  } catch (err) {
    return { kind: "failed", error: `the improvement could not be kept in ${dir}: ${String(err)}`, costUsd };
  }
  return { kind: "ok", candidate: { dir, skillText, note, costUsd } };
}

/** Writes an improvement of the skill in `baseSkillDir` from `baseline` and keeps it in `dir`. */
export async function writeCandidate(
  set: SkillEvalSet,
  baseSkillDir: string,
  baseline: SkillEvalRun,
  dir: string,
  deps: AttemptDeps,
): Promise<CandidateResult> {
  const work = await mkdtemp(path.join(deps.tmpRoot, "improve-"));
  try {
    await writeInputs(work, baseSkillDir, baseline);
    const before = await readFile(path.join(work, SKILL_FOLDER, "SKILL.md"), "utf8");
    const args = improveArgs(set.improveModel, SKILL_EVAL_IMPROVE_BUDGET_USD);
    const ran = await deps.runClaude({ bin: deps.claudeBin, args, prompt: improvePrompt(), cwd: work, timeoutMs: ATTEMPT_TIMEOUT_MS });
    const outcome = streamOutcome(ran.stdout.split("\n"), "");
    const error = ran.failure ?? outcome.error;
    if (error !== null) return { kind: "failed", error, costUsd: outcome.costUsd };
    return await keepCandidate(work, dir, before, outcome.finalText, outcome.costUsd);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
