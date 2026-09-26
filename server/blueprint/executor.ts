// Drives a blueprint build: start the current step, hand it to a fresh agent session, run its
// check when that session's turn ends, and move on — stopping only where the state says a person
// is needed. The decisions are `nextAction` (common/blueprint/executorPolicy.ts) and the rules are
// `applyEvent`; this file only performs what they say and records the outcome.
//
// One run's work is serialised: a turn ending and a person approving at the same moment must not
// both read the same state and each write their own successor.
import path from "node:path";
import { applyEvent, currentStep, initialState, type BlueprintState, type StepEvent } from "../../common/blueprint/state.js";
import { OPEN_QUESTIONS_FILE, SPEC_FILE, replyFile, specRevisionPrompt } from "../../common/blueprint/specRevisionPrompt.js";
import { MAX_FAILED_CHECKS, nextAction, type ExecutorAction } from "../../common/blueprint/executorPolicy.js";
import { stepPrompt } from "../../common/blueprint/stepPrompt.js";
import { summarizeRun, type BlueprintRun, type BlueprintRunSummary } from "../../common/blueprint/run.js";
import type { ComposedStep } from "../../common/blueprint/plan.js";
import type { RunStore } from "./runStore.js";
import type { CheckRequest, CheckResult } from "./checkRunner.js";

export interface ExecutorDeps {
  store: RunStore;
  /** Start agent session `sessionId` in `cwd`, running `prompt`. */
  spawnStepSession: (cwd: string, prompt: string, sessionId: string) => void;
  newSessionId: () => string;
  /** Call `callback` once when that session's turn ends — `didError` when it ended without one
   *  (killed, reaped, crashed) rather than by finishing a turn. */
  onTurnEnded: (sessionId: string, callback: (outcome: { didError: boolean }) => Promise<void>) => void;
  runCheck: (request: CheckRequest) => Promise<CheckResult>;
  /** The shell command a step's agent runs to ask the user `$QUESTION` — carrying its session id,
   *  so only the session working on the step can ask. */
  askCommand: (runId: string, stepId: string, sessionId: string) => string;
  newRunId: () => string;
  now: () => number;
  /** Whether an agent can start in the project without a trust prompt nobody is there to answer.
   *  Asked before EVERY session: a step can make the folder a git repository, which takes the
   *  trust it had from its parent away. */
  isTrusted?: (dir: string) => Promise<boolean>;
  /** Files the build keeps in the project (the spec, the agent's reply), read and removed by path. */
  projectFiles: ProjectFiles;
  /** End a session this build started and no longer needs (its terminal closes). Closing one that
   *  is already gone does nothing. */
  closeSession: (sessionId: string) => void;
}

export interface ProjectFiles {
  read: (dir: string, relativePath: string) => Promise<string | null>;
  remove: (dir: string, relativePath: string) => Promise<void>;
}

type ChatOutcome = NonNullable<BlueprintRun["specChat"][number]["outcome"]>;

function replyOutcome(didError: boolean, reply: string | null): ChatOutcome {
  if (didError) return "lost";
  return reply ? "reply" : "no-reply";
}

export interface SpecView {
  spec: string | null;
  openQuestions: string | null;
  chat: BlueprintRun["specChat"];
  revising: boolean;
}

// The spec may be talked over only while the build waits for a person to read it: at a review gate,
// with no agent working and no earlier message still being answered.
function specChatRefusal({ run, state }: { run: BlueprintRun; state: BlueprintState }): string | null {
  const step = currentStep(run.steps, state);
  if (!step || state.steps[step.id]?.status !== "awaiting-approval" || !step.gates.includes("review"))
    return "the spec can be discussed only while it waits for review";
  if (run.revisionSessionId !== null) return "the previous message is still being answered";
  return run.activeSessionId === null ? null : "an agent is working on the build";
}

// A person's events. The agent has its own door (`ask`), and checks are run here, never reported.
export type HumanEvent = Extract<StepEvent, { type: "approve" } | { type: "reject" } | { type: "answer" } | { type: "retry" }>;

// Each pass either changes the state or stops, and a plan has a bounded number of states to pass
// through; the cap only turns a bug in that reasoning into an error instead of a hung server.
const MAX_PASSES_PER_ADVANCE = 64;

export class BlueprintRefusal extends Error {}

// A session that asked, and was answered before its turn ended, stopped to wait for that answer —
// its work is not finished, so checking it would only burn an attempt. The answer goes to a new
// session instead.
function needsCheck(state: BlueprintState, session: { stepId: string; atMs: number; answersAtStart?: number | undefined }): boolean {
  const stepState = state.steps[session.stepId];
  if (stepState?.status !== "running") return false;
  // Runs recorded before the count existed fall back to comparing times.
  if (session.answersAtStart === undefined) return !stepState.answers.some((entry) => entry.atMs >= session.atMs);
  return stepState.answers.length <= session.answersAtStart;
}

type Loaded = { run: BlueprintRun; state: BlueprintState };

export const untrustedOutput = (dir: string): string =>
  `Claude Code does not trust ${dir} (a step may have made it a git repository, which needs its own trust). Open a terminal there, accept the trust prompt, then retry this step.`;

// Recorded as the check output when a step's session ended without finishing a turn. The check
// script is NOT run for such a session: whatever it left behind was not claimed as done.
export const LOST_SESSION_OUTPUT = "The session ended before finishing its turn (it was closed, reaped or crashed). The check was not run.";

export interface CreateRunRequest {
  projectDir: string;
  basePackDir: string;
  usecasePackDir: string;
  steps: ComposedStep[];
}

const stepOf = (run: BlueprintRun, stepId: string): ComposedStep | undefined => run.steps.find((step) => step.id === stepId);

function applied(loaded: Loaded, stepId: string, event: StepEvent): Loaded {
  const result = applyEvent(loaded.run.steps, loaded.state, stepId, event);
  if (!result.ok) throw new BlueprintRefusal(result.reason);
  return { run: loaded.run, state: result.state };
}

const actionFor = ({ run, state }: Loaded): ExecutorAction =>
  nextAction({ steps: run.steps, state, failedChecks: run.failedChecks, sessionActive: run.activeSessionId !== null });

// Whether the build, as it stands, stops on this step's failure for a person (rather than retrying).
const waitsOnFailure = (loaded: Loaded, stepId: string): boolean => {
  const action = actionFor(loaded);
  return action.kind === "wait" && action.on === "failure" && action.stepId === stepId;
};

class Executor {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: ExecutorDeps) {}

  async create(request: CreateRunRequest): Promise<string> {
    const run: BlueprintRun = {
      id: this.deps.newRunId(),
      ...request,
      failedChecks: {},
      activeSessionId: null,
      sessions: [],
      createdAtMs: this.deps.now(),
      specChat: [],
      revisionSessionId: null,
    };
    const state = initialState(request.steps);
    await this.deps.store.save(run, state);
    await this.serially(run.id, () => this.advance({ run, state }));
    return run.id;
  }

  view(runId: string): Promise<Loaded> {
    return this.mustLoad(runId);
  }

  /** Every build, newest first. One that cannot be read is left out rather than failing the list. */
  async list(): Promise<BlueprintRunSummary[]> {
    const loaded = await Promise.all((await this.deps.store.list()).map((runId) => this.deps.store.load(runId).catch(() => null)));
    return loaded.flatMap((entry) => (entry ? [summarizeRun(entry.run, entry.state)] : [])).sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  /** A person approved, rejected, answered or asked to retry. */
  humanEvent(runId: string, stepId: string, event: HumanEvent): Promise<Loaded> {
    return this.serially(runId, async () => {
      const before = await this.mustLoad(runId);
      if (before.run.revisionSessionId !== null) throw new BlueprintRefusal("the spec is still being revised; wait for the reply");
      const loaded = applied(before, stepId, event);
      if (event.type === "retry") this.closeSessionsOf(before.run, stepId);
      // A person's retry is a fresh start for the automatic retries, too.
      const run = event.type === "retry" ? { ...loaded.run, failedChecks: { ...loaded.run.failedChecks, [stepId]: 0 } } : loaded.run;
      await this.deps.store.save(run, loaded.state);
      return this.advance({ run, state: loaded.state });
    });
  }

  /** The agent working on `stepId` needs a decision. Only that session may ask. */
  ask(runId: string, stepId: string, question: string, sessionId: string): Promise<Loaded> {
    return this.serially(runId, async () => {
      const loaded = await this.mustLoad(runId);
      if (loaded.run.activeSessionId === null) throw new BlueprintRefusal("no agent is working on this build");
      if (loaded.run.activeSessionId !== sessionId) throw new BlueprintRefusal("this session is not the one working on the step");
      const asked = applied(loaded, stepId, { type: "ask", question });
      await this.deps.store.save(asked.run, asked.state);
      return asked;
    });
  }

  /** After a restart the in-memory turn hooks are gone, and a Stop that fired while the server was
   *  down is gone with them — so a surviving session cannot be trusted to report again. Each one is
   *  ended and settled as a session that never finished; the retry that follows starts a fresh
   *  session with the check's context, and two sessions never work on one step. */
  async recover(endSession: (sessionId: string) => void): Promise<void> {
    const loadedRuns = await Promise.all((await this.deps.store.list()).map((runId) => this.deps.store.load(runId).catch(() => null)));
    const active = loadedRuns.flatMap((loaded) => (loaded?.run.activeSessionId ? [{ runId: loaded.run.id, sessionId: loaded.run.activeSessionId }] : []));
    await Promise.all(
      active.map(({ runId, sessionId }) => {
        endSession(sessionId);
        return this.turnEnded(runId, sessionId, true);
      }),
    );
    // A spec reply cut off by the restart is recorded as lost; the person can simply send again.
    const revising = loadedRuns.flatMap((loaded) => (loaded?.run.revisionSessionId ? [{ runId: loaded.run.id, sessionId: loaded.run.revisionSessionId }] : []));
    await Promise.all(
      revising.map(({ runId, sessionId }) => {
        endSession(sessionId);
        return this.revisionEnded(runId, sessionId, true);
      }),
    );
    // A run the server stopped mid-advance (a step started, no session yet) is picked up again.
    const idle = loadedRuns.flatMap((loaded) => (loaded && !loaded.run.activeSessionId ? [loaded.run.id] : []));
    await Promise.all(idle.map((runId) => this.serially(runId, async () => this.advance(await this.mustLoad(runId)))));
  }

  /** The spec as it stands, its open questions, and the conversation about it. */
  async specView(runId: string): Promise<SpecView> {
    const { run } = await this.mustLoad(runId);
    const [spec, openQuestions] = await Promise.all([
      this.deps.projectFiles.read(run.projectDir, SPEC_FILE),
      this.deps.projectFiles.read(run.projectDir, OPEN_QUESTIONS_FILE),
    ]);
    return { spec, openQuestions, chat: run.specChat, revising: run.revisionSessionId !== null };
  }

  /** A person's message about the spec: a fresh session changes the spec and writes a reply. */
  say(runId: string, message: string): Promise<Loaded> {
    return this.serially(runId, async () => {
      const loaded = await this.mustLoad(runId);
      const refusal = specChatRefusal(loaded);
      if (refusal) throw new BlueprintRefusal(refusal);
      const { run } = loaded;
      if (!(await this.trusted(run))) throw new BlueprintRefusal(untrustedOutput(run.projectDir));
      const sessionId = this.deps.newSessionId();
      const prompt = specRevisionPrompt({
        chat: run.specChat,
        message,
        packDirs: { base: run.basePackDir, usecase: run.usecasePackDir },
        replyPath: replyFile(sessionId),
      });
      const specChat = [...run.specChat, { role: "person" as const, text: message, atMs: this.deps.now() }];
      const next: Loaded = { run: { ...run, revisionSessionId: sessionId, specChat }, state: loaded.state };
      // Saved BEFORE the spawn: a crash in between leaves a recorded revision that recovery settles as
      // lost, rather than a session running that no record knows about.
      await this.deps.store.save(next.run, next.state);
      this.deps.spawnStepSession(run.projectDir, prompt, sessionId);
      this.deps.onTurnEnded(sessionId, ({ didError }) => this.revisionEnded(runId, sessionId, didError));
      return next;
    });
  }

  private revisionEnded(runId: string, sessionId: string, didError: boolean): Promise<void> {
    return this.serially(runId, async () => {
      const { run, state } = await this.mustLoad(runId);
      if (run.revisionSessionId !== sessionId) return;
      try {
        const reply = didError ? null : ((await this.deps.projectFiles.read(run.projectDir, replyFile(sessionId))) ?? "").trim();
        await this.deps.projectFiles.remove(run.projectDir, replyFile(sessionId));
        const outcome = replyOutcome(didError, reply);
        const specChat = [...run.specChat, { role: "agent" as const, text: reply ?? "", atMs: this.deps.now(), outcome }];
        await this.deps.store.save({ ...run, revisionSessionId: null, specChat }, state);
      } finally {
        this.deps.closeSession(sessionId);
      }
    });
  }

  // The sessions a step used; a failed step's last one was kept open for the person to look into.
  private closeSessionsOf(run: BlueprintRun, stepId: string): void {
    run.sessions
      .filter((entry) => entry.stepId === stepId && entry.sessionId !== run.activeSessionId)
      .forEach((entry) => this.deps.closeSession(entry.sessionId));
  }

  // The agent's session stopped. If it stopped to ask, the state already says so and there is
  // nothing to check; otherwise the check — not the agent — decides whether the step is done.
  private turnEnded(runId: string, sessionId: string, didError: boolean): Promise<void> {
    return this.serially(runId, async () => {
      const loaded = await this.mustLoad(runId);
      if (loaded.run.activeSessionId !== sessionId) return;
      const released: Loaded = { run: { ...loaded.run, activeSessionId: null }, state: loaded.state };
      const session = loaded.run.sessions.findLast((entry) => entry.sessionId === sessionId);
      // Closed BEFORE advancing: a session whose turn ended can still have background work running,
      // and a retry started beside it would have two agents rewriting one folder. Only one that failed
      // and now waits for a person stays open, to be looked into; a person's retry closes it.
      const settled = await this.settleAndSave(released, session, didError).catch((err: unknown) => {
        this.deps.closeSession(sessionId);
        throw err;
      });
      if (!session || !waitsOnFailure(settled, session.stepId)) this.deps.closeSession(sessionId);
      await this.advance(settled);
    });
  }

  private async settleAndSave(released: Loaded, session: BlueprintRun["sessions"][number] | undefined, didError: boolean): Promise<Loaded> {
    const settled = session && needsCheck(released.state, session) ? await this.settleTurn(released, session.stepId, didError) : released;
    await this.deps.store.save(settled.run, settled.state);
    return settled;
  }

  private serially<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(runId) ?? Promise.resolve()).then(work, work);
    this.queues.set(
      runId,
      result.catch(() => undefined),
    );
    return result;
  }

  private async mustLoad(runId: string): Promise<Loaded> {
    const loaded = await this.deps.store.load(runId);
    if (!loaded) throw new BlueprintRefusal(`no blueprint run ${runId}`);
    return loaded;
  }

  // Loops rather than recursing so each pass is saved before the next one can spawn.
  private async advance(initial: Loaded): Promise<Loaded> {
    let current = initial;
    for (let pass = 0; pass < MAX_PASSES_PER_ADVANCE; pass++) {
      const action = actionFor(current);
      const next = action.kind === "spawn" && !(await this.trusted(current.run)) ? this.untrusted(current, action.stepId) : this.perform(current, action);
      if (!next) return current;
      await this.deps.store.save(next.run, next.state);
      current = next;
    }
    throw new Error(`blueprint run ${initial.run.id} did not settle`);
  }

  private async trusted(run: BlueprintRun): Promise<boolean> {
    return this.deps.isTrusted ? this.deps.isTrusted(run.projectDir) : true;
  }

  // The step fails with the reason, and with no automatic retries left: a retry cannot trust the
  // folder, only a person can. Their retry resets the count and asks again.
  private untrusted(loaded: Loaded, stepId: string): Loaded {
    const failed = this.recordCheck(loaded, stepId, { ok: false, output: untrustedOutput(loaded.run.projectDir) });
    return { run: { ...failed.run, failedChecks: { ...failed.run.failedChecks, [stepId]: MAX_FAILED_CHECKS } }, state: failed.state };
  }

  // Performs one action; null means "stop here".
  private perform(loaded: Loaded, action: ExecutorAction): Loaded | null {
    if (action.kind === "start") return applied(loaded, action.stepId, { type: "start" });
    if (action.kind === "retry") return applied(loaded, action.stepId, { type: "retry" });
    if (action.kind === "spawn") return this.spawnFor(loaded, action.stepId);
    return null;
  }

  private spawnFor({ run, state }: Loaded, stepId: string): Loaded {
    const step = stepOf(run, stepId);
    if (!step) throw new BlueprintRefusal(`no step ${stepId}`);
    const packDir = step.origin === "base" ? run.basePackDir : run.usecasePackDir;
    const skillFile = path.join(packDir, step.skill, "SKILL.md");
    const sessionId = this.deps.newSessionId();
    const prompt = stepPrompt({
      step,
      skillFile,
      packDirs: { base: run.basePackDir, usecase: run.usecasePackDir },
      stepState: state.steps[stepId],
      askCommand: this.deps.askCommand(run.id, stepId, sessionId),
    });
    this.deps.spawnStepSession(run.projectDir, prompt, sessionId);
    this.deps.onTurnEnded(sessionId, ({ didError }) => this.turnEnded(run.id, sessionId, didError));
    const sessions = [...run.sessions, { stepId, sessionId, atMs: this.deps.now(), answersAtStart: state.steps[stepId]?.answers.length ?? 0 }];
    return { run: { ...run, activeSessionId: sessionId, sessions }, state };
  }

  private async settleTurn(loaded: Loaded, stepId: string, didError: boolean): Promise<Loaded> {
    const step = stepOf(loaded.run, stepId);
    if (!step) return loaded;
    if (didError) return this.recordCheck(loaded, stepId, { ok: false, output: LOST_SESSION_OUTPUT });
    const { run } = loaded;
    return this.recordCheck(
      loaded,
      stepId,
      await this.deps.runCheck({ command: step.check, cwd: run.projectDir, basePackDir: run.basePackDir, usecasePackDir: run.usecasePackDir }),
    );
  }

  private recordCheck(loaded: Loaded, stepId: string, result: CheckResult): Loaded {
    const checked = applied(loaded, stepId, { type: "check", ok: result.ok, output: result.output, atMs: this.deps.now() });
    if (result.ok) return checked;
    const failedChecks = { ...checked.run.failedChecks, [stepId]: (checked.run.failedChecks[stepId] ?? 0) + 1 };
    return { run: { ...checked.run, failedChecks }, state: checked.state };
  }
}

export type BlueprintExecutor = Pick<Executor, "create" | "view" | "list" | "humanEvent" | "ask" | "recover" | "specView" | "say">;

export const createExecutor = (deps: ExecutorDeps): BlueprintExecutor => new Executor(deps);
