// Runs a skill evaluation in the background (#3438): every attempt the set calls for, a few at a time,
// the record rewritten after each so a reader always sees the progress and a stopped server leaves
// what it had. One evaluation at a time per server: they would compete for the same rate limits.
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { ladderAttempts, plannedAttempts, type SkillEvalArm, type SkillEvalCase, type SkillEvalRun, type SkillEvalSet } from "../../../common/skillEval.js";
import { runAttempt, type AttemptDeps, type AttemptPlan } from "./evalAttempt.js";
import { caseFilesDir, textHash, writeRun } from "./evalStore.js";
import { candidateDir, writeCandidate } from "./evalImprove.js";
import { ladderStepPassedAll } from "../../../common/skillEvalLadder.js";

/** Attempts in flight at once: enough to finish a set in minutes, few enough not to hit a rate limit. */
export const EVAL_CONCURRENCY = 2;

export interface EvalStart {
  /** The skill's evaluation folder: its set, its case files, its runs. */
  evalDir: string;
  set: SkillEvalSet;
  setHash: string;
  skillDir: string;
  skillSlug: string;
  skillText: string;
  skillHash: string;
  /** Measure an improvement written from this finished run, instead of the skill as it is (#3448). */
  improveFrom?: SkillEvalRun | null;
  /** Search the set's ladder for the cheapest model that is enough, instead of measuring with and without (#3453). */
  ladder?: boolean;
}

interface ActiveRun {
  id: string;
  evalDir: string;
  stopRequested: boolean;
  done: Promise<void>;
}

let active: ActiveRun | null = null;

export const activeRunId = (evalDir: string): string | null => (active !== null && active.evalDir === evalDir ? active.id : null);

/** Round by round, so a run stopped halfway has every case measured the same number of times. */
export function attemptOrder(set: SkillEvalSet): { evalCase: SkillEvalCase; arm: SkillEvalArm; round: number }[] {
  return Array.from({ length: set.repeats }, (_, round) => round).flatMap((round) =>
    set.cases.flatMap((evalCase) => {
      const arms: SkillEvalArm[] = evalCase.kind === "use" ? ["with", "without"] : ["with"];
      return arms.map((arm) => ({ evalCase, arm, round }));
    }),
  );
}

type PlannedAttempt = ReturnType<typeof attemptOrder>[number];

/** One step of the search: each "use" case with the skill, round by round, on that step's model. */
export function ladderOrder(set: SkillEvalSet): PlannedAttempt[] {
  return Array.from({ length: set.repeats }, (_, round) => round).flatMap((round) =>
    set.cases.filter((evalCase) => evalCase.kind === "use").map((evalCase) => ({ evalCase, arm: "with" as const, round })),
  );
}

const newRunId = (now_ms: number): string => `${String(now_ms).padStart(13, "0")}-${randomBytes(4).toString("hex")}`;

function initialRun(start: EvalStart, id: string, now_ms: number): SkillEvalRun {
  const improving = start.improveFrom != null;
  return {
    ...{ id, skill: start.set.skill, status: "running", startedAt: now_ms, finishedAt: null, model: start.set.model, repeats: start.set.repeats },
    // An improvement's text is not known until it has been written.
    ...{ skillText: improving ? "" : start.skillText, skillHash: improving ? "" : start.skillHash, setHash: start.setHash, cases: start.set.cases },
    ...{
      plannedAttempts: start.ladder ? ladderAttempts(start.set) : plannedAttempts(start.set),
      attempts: [],
      candidateId: improving ? id : null,
      note: "",
      improveCostUsd: 0,
    },
    ...{ baseSkillHash: improving ? start.skillHash : "", baseRunId: start.improveFrom?.id ?? null, ladder: start.ladder ? start.set.ladder : [] },
    interruptedBy: "",
  };
}

/** The folder the attempts copy the skill from: the snapshot, or for an improvement run the improvement,
 *  written first from the snapshot. Null when it could not be written, which ends the run. */
async function measuredSkill(run: SkillEvalRun, start: EvalStart, skillCopy: string, save: Save, deps: AttemptDeps): Promise<string | null> {
  if (start.improveFrom == null) return skillCopy;
  const written = await writeCandidate(start.set, skillCopy, start.improveFrom, candidateDir(start.evalDir, run.id), deps);
  if (written.kind === "failed") {
    Object.assign(run, { improveCostUsd: written.costUsd, note: written.error });
    return null;
  }
  const { candidate } = written;
  Object.assign(run, { improveCostUsd: candidate.costUsd, note: candidate.note, skillText: candidate.skillText, skillHash: textHash(candidate.skillText) });
  await save();
  return candidate.dir;
}

/** Every attempt copies the skill from `skillCopy`, taken once at the start: an edit made while the run
 *  goes on must not reach its later rounds, which are recorded as measuring the text read at the start. */
function plansOf(start: EvalStart, skillCopy: string, order: PlannedAttempt[], model: string): AttemptPlan[] {
  return order.map(({ evalCase, arm, round }) => {
    const filesDir = caseFilesDir(start.evalDir, evalCase.id);
    return { set: start.set, evalCase, arm, round, model, skillDir: skillCopy, skillSlug: start.skillSlug, filesDir };
  });
}

/** Writes the run record as it is now; answers whether it landed. */
type Save = () => Promise<boolean>;

/** Saves one after another: two attempts finishing together must not land their records out of order.
 *  Answers whether this save landed, and never fails: each save writes the whole record, so one that did
 *  not land is made good by the next — on Windows a reader holding the file makes the rename fail (#3458). */
function serialSaver(evalDir: string, run: SkillEvalRun): Save {
  let last: Promise<boolean> = Promise.resolve(true);
  return () => {
    const snapshot: SkillEvalRun = { ...run, attempts: [...run.attempts] };
    last = last
      .then(() => writeRun(evalDir, snapshot))
      .then(
        () => true,
        () => false,
      );
    return last;
  };
}

/** Waits between tries of the last save, the one no later save makes good: unsaved, the record says running. */
export const FINAL_SAVE_RETRY_DELAYS_MS = [100, 250, 500, 1000, 2000];

async function saveLast(save: Save): Promise<void> {
  for (const delay_ms of [...FINAL_SAVE_RETRY_DELAYS_MS, null]) {
    if (await save()) return;
    if (delay_ms !== null) await new Promise((resolve) => setTimeout(resolve, delay_ms));
  }
}

async function drain(queue: AttemptPlan[], run: SkillEvalRun, self: ActiveRun, save: Save, deps: AttemptDeps): Promise<void> {
  try {
    for (let plan = queue.shift(); plan !== undefined && !self.stopRequested; plan = queue.shift()) {
      run.attempts.push(await runAttempt(plan, deps));
      await save();
    }
  } catch (err) {
    queue.length = 0; // the other worker finishes what it holds and takes nothing more
    throw err;
  }
}

function finalStatus(failed: boolean, stopRequested: boolean): SkillEvalRun["status"] {
  if (failed) return "interrupted";
  return stopRequested ? "stopped" : "done";
}

const failureText = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

interface Measuring {
  run: SkillEvalRun;
  self: ActiveRun;
  save: Save;
  deps: AttemptDeps;
}

/** Every plan, a few at a time; true when a worker failed. The run is released only once every worker has
 *  settled, so a new one never overlaps an old attempt. */
async function measurePlans(plans: AttemptPlan[], measuring: Measuring): Promise<boolean> {
  const { run, self, save, deps } = measuring;
  const queue = [...plans];
  const workers = await Promise.allSettled(Array.from({ length: EVAL_CONCURRENCY }, () => drain(queue, run, self, save, deps)));
  const failure = workers.find((worker) => worker.status === "rejected");
  if (failure === undefined) return false;
  run.interruptedBy = failureText(failure.reason);
  return true;
}

/** One model after another, cheapest first, until one passes everything; true when a worker failed. */
async function climbLadder(start: EvalStart, skillDir: string, measuring: Measuring): Promise<boolean> {
  for (const model of start.set.ladder) {
    const plans = plansOf(start, skillDir, ladderOrder(start.set), model);
    if (await measurePlans(plans, measuring)) return true;
    const stepAttempts = measuring.run.attempts.filter((attempt) => attempt.model === model);
    if (measuring.self.stopRequested || ladderStepPassedAll(stepAttempts, plans.length)) return false;
  }
  return false;
}

async function measureSkill(start: EvalStart, skillDir: string, measuring: Measuring): Promise<boolean> {
  if (start.ladder) return climbLadder(start, skillDir, measuring);
  return measurePlans(plansOf(start, skillDir, attemptOrder(start.set), start.set.model), measuring);
}

async function execute(run: SkillEvalRun, self: ActiveRun, start: EvalStart, skillCopy: string, deps: AttemptDeps): Promise<void> {
  const save = serialSaver(start.evalDir, run);
  try {
    const skillDir = await measuredSkill(run, start, skillCopy, save, deps);
    if (skillDir === null) {
      run.status = "interrupted";
      return;
    }
    const failed = await measureSkill(start, skillDir, { run, self, save, deps });
    run.status = finalStatus(failed, self.stopRequested);
  } catch (err) {
    run.status = "interrupted";
    run.interruptedBy = failureText(err);
  } finally {
    run.finishedAt = deps.now();
    await saveLast(save);
    await rm(skillCopy, { recursive: true, force: true });
    active = null;
  }
}

/** Starts a run and answers its id at once, or null when another evaluation is already running. */
export async function startEvalRun(start: EvalStart, deps: AttemptDeps): Promise<{ id: string; done: Promise<void> } | null> {
  if (active !== null) return null;
  const id = newRunId(deps.now());
  const run = initialRun(start, id, deps.now());
  const self: ActiveRun = { id, evalDir: start.evalDir, stopRequested: false, done: Promise.resolve() };
  active = self;
  const skillCopy = await mkdtemp(path.join(deps.tmpRoot, "skill-")).catch((err: unknown) => {
    active = null;
    throw err;
  });
  try {
    // Dereferenced, so nothing that edits the copy can write through a link into the skill itself.
    await cp(start.skillDir, skillCopy, { recursive: true, dereference: true });
    await writeRun(start.evalDir, run);
  } catch (err) {
    await rm(skillCopy, { recursive: true, force: true });
    active = null;
    throw err;
  }
  self.done = execute(run, self, start, skillCopy, deps);
  return { id, done: self.done };
}

/** Asks a run to stop after the attempts in flight; true when it was this server's running one. */
export function stopEvalRun(runId: string): boolean {
  if (active === null || active.id !== runId) return false;
  active.stopRequested = true;
  return true;
}

/** A record still marked running that this server is not running was left by a server that stopped. */
export const effectiveStatus = (run: SkillEvalRun): SkillEvalRun["status"] => (run.status === "running" && active?.id !== run.id ? "interrupted" : run.status);
