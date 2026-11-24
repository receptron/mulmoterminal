// Runs a skill evaluation in the background (#3438): every attempt the set calls for, a few at a time,
// the record rewritten after each so a reader always sees the progress and a stopped server leaves
// what it had. One evaluation at a time per server: they would compete for the same rate limits.
import { randomBytes } from "node:crypto";
import { plannedAttempts, type SkillEvalArm, type SkillEvalCase, type SkillEvalRun, type SkillEvalSet } from "../../../common/skillEval.js";
import { runAttempt, type AttemptDeps, type AttemptPlan } from "./evalAttempt.js";
import { caseFilesDir, writeRun } from "./evalStore.js";

/** Attempts in flight at once: enough to finish a set in minutes, few enough not to hit a rate limit. */
export const EVAL_CONCURRENCY = 2;

export interface EvalStart {
  root: string;
  set: SkillEvalSet;
  setHash: string;
  skillDir: string;
  skillSlug: string;
  skillText: string;
  skillHash: string;
}

interface ActiveRun {
  id: string;
  skill: string;
  stopRequested: boolean;
  done: Promise<void>;
}

let active: ActiveRun | null = null;

export const activeRunId = (skillId: string): string | null => (active !== null && active.skill === skillId ? active.id : null);
export const isEvalRunning = (): boolean => active !== null;

/** Round by round, so a run stopped halfway has every case measured the same number of times. */
export function attemptOrder(set: SkillEvalSet): { evalCase: SkillEvalCase; arm: SkillEvalArm; round: number }[] {
  return Array.from({ length: set.repeats }, (_, round) => round).flatMap((round) =>
    set.cases.flatMap((evalCase) => {
      const arms: SkillEvalArm[] = evalCase.kind === "use" ? ["with", "without"] : ["with"];
      return arms.map((arm) => ({ evalCase, arm, round }));
    }),
  );
}

const newRunId = (now_ms: number): string => `${String(now_ms).padStart(13, "0")}-${randomBytes(4).toString("hex")}`;

function initialRun(start: EvalStart, id: string, now_ms: number): SkillEvalRun {
  return {
    ...{ id, skill: start.set.skill, status: "running", startedAt: now_ms, finishedAt: null, model: start.set.model, repeats: start.set.repeats },
    ...{ skillText: start.skillText, skillHash: start.skillHash, setHash: start.setHash, cases: start.set.cases },
    ...{ plannedAttempts: plannedAttempts(start.set), attempts: [] },
  };
}

function plansOf(start: EvalStart): AttemptPlan[] {
  return attemptOrder(start.set).map(({ evalCase, arm, round }) => {
    const filesDir = caseFilesDir(start.root, start.set.skill, evalCase.id);
    return { set: start.set, evalCase, arm, round, skillDir: start.skillDir, skillSlug: start.skillSlug, filesDir };
  });
}

/** Saves one after another: two attempts finishing together must not land their records out of order. */
function serialSaver(root: string, run: SkillEvalRun): () => Promise<void> {
  let last = Promise.resolve();
  return () => {
    const snapshot: SkillEvalRun = { ...run, attempts: [...run.attempts] };
    last = last.then(() => writeRun(root, snapshot));
    return last;
  };
}

async function drain(queue: AttemptPlan[], run: SkillEvalRun, self: ActiveRun, save: () => Promise<void>, deps: AttemptDeps): Promise<void> {
  for (let plan = queue.shift(); plan !== undefined && !self.stopRequested; plan = queue.shift()) {
    run.attempts.push(await runAttempt(plan, deps));
    await save();
  }
}

async function execute(run: SkillEvalRun, self: ActiveRun, start: EvalStart, deps: AttemptDeps): Promise<void> {
  const queue = plansOf(start);
  const save = serialSaver(start.root, run);
  try {
    await Promise.all(Array.from({ length: EVAL_CONCURRENCY }, () => drain(queue, run, self, save, deps)));
    run.status = self.stopRequested ? "stopped" : "done";
  } catch {
    run.status = "interrupted";
  } finally {
    run.finishedAt = deps.now();
    await save().catch(() => {});
    active = null;
  }
}

/** Starts a run and answers its id at once, or null when another evaluation is already running. */
export async function startEvalRun(start: EvalStart, deps: AttemptDeps): Promise<{ id: string; done: Promise<void> } | null> {
  if (active !== null) return null;
  const id = newRunId(deps.now());
  const run = initialRun(start, id, deps.now());
  const self: ActiveRun = { id, skill: start.set.skill, stopRequested: false, done: Promise.resolve() };
  active = self;
  try {
    await writeRun(start.root, run);
  } catch (err) {
    active = null;
    throw err;
  }
  self.done = execute(run, self, start, deps);
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
