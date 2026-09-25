// Where a build stands, persisted so a run can stop and resume. Every change goes through
// `applyEvent`, which is the one place the rules live: a gated step cannot run unapproved, a step
// cannot start before the one ahead of it passed, and only a check passes one.
//
// These rules bind the EXECUTOR — it will not move past a gate on its own — and are not a sandbox
// around the agent, which acts as the same user and could call any local route or run any CLI
// itself. What they do rule out is the executor being talked past a gate by the project: the state
// file lives where the server keeps it, not in the directory the agent is working in, and the
// route meant for the agent accepts only AGENT_EVENT_TYPES.
import { z } from "zod";
import type { PlanStep } from "./plan.js";

export const STEP_STATUSES = ["pending", "awaiting-approval", "running", "awaiting-answer", "passed", "failed"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

const stepStateSchema = z.object({
  status: z.enum(STEP_STATUSES),
  approved: z.boolean().default(false),
  question: z.string().optional(),
  answers: z.array(z.object({ question: z.string(), answer: z.string(), atMs: z.number() })).default([]),
  lastCheck: z.object({ ok: z.boolean(), output: z.string(), atMs: z.number() }).optional(),
  reason: z.string().optional(),
});

export const blueprintStateSchema = z.object({ steps: z.record(z.string(), stepStateSchema) });

export type StepState = z.infer<typeof stepStateSchema>;
export type BlueprintState = z.infer<typeof blueprintStateSchema>;

export type StepEvent =
  | { type: "start" }
  | { type: "approve" }
  | { type: "reject"; reason: string }
  | { type: "ask"; question: string }
  | { type: "answer"; answer: string; atMs: number }
  | { type: "check"; ok: boolean; output: string; atMs: number }
  | { type: "retry" };

// What the agent in the cell may report. Approval, rejection and answers come from the person;
// checks are run by the executor, never claimed by the agent.
export const AGENT_EVENT_TYPES = ["ask"] as const satisfies readonly StepEvent["type"][];

export const isAgentEvent = (event: StepEvent): boolean => AGENT_EVENT_TYPES.some((type) => type === event.type);

export type TransitionResult = { ok: true; state: BlueprintState } | { ok: false; reason: string };

type StepTransition = (step: PlanStep, current: StepState, event: StepEvent) => StepState;

const freshStep = (): StepState => ({ status: "pending", approved: false, answers: [] });

export const initialState = (steps: readonly PlanStep[]): BlueprintState => ({
  steps: Object.fromEntries(steps.map((step) => [step.id, freshStep()])),
});

const start: StepTransition = (step, current) =>
  step.gates.length > 0 && !current.approved ? { ...current, status: "awaiting-approval" } : { ...current, status: "running", reason: undefined };

const answer: StepTransition = (_step, current, event) =>
  event.type !== "answer"
    ? current
    : {
        ...current,
        status: "running",
        question: undefined,
        answers: [...current.answers, { question: current.question ?? "", answer: event.answer, atMs: event.atMs }],
      };

const check: StepTransition = (_step, current, event) => {
  if (event.type !== "check") return current;
  const lastCheck = { ok: event.ok, output: event.output, atMs: event.atMs };
  return event.ok ? { ...current, status: "passed", lastCheck, reason: undefined } : { ...current, status: "failed", lastCheck, reason: "check failed" };
};

// `${status}:${event}` → what happens. A pair not listed is refused.
const TRANSITIONS: Readonly<Record<string, StepTransition>> = {
  "pending:start": start,
  "awaiting-approval:approve": (_step, current) => ({ ...current, status: "running", approved: true }),
  "awaiting-approval:reject": (_step, current, event) => ({ ...current, status: "failed", reason: event.type === "reject" ? event.reason : "rejected" }),
  "running:ask": (_step, current, event) => ({ ...current, status: "awaiting-answer", question: event.type === "ask" ? event.question : undefined }),
  // Asking again before an answer came replaces the question: the agent corrected itself, and the
  // person should see what it asks now — not a stale first try that nothing can move past.
  "awaiting-answer:ask": (_step, current, event) => ({ ...current, question: event.type === "ask" ? event.question : current.question }),
  "awaiting-answer:answer": answer,
  "running:check": check,
  // Approval survives a retry: a billing step whose check failed is not a new billing decision.
  "failed:retry": (_step, current) => ({ ...current, status: "pending", reason: undefined }),
};

const earlierUnpassed = (steps: readonly PlanStep[], index: number, state: BlueprintState): PlanStep | undefined =>
  steps.slice(0, index).find((step) => state.steps[step.id]?.status !== "passed");

function eventRefusal(steps: readonly PlanStep[], step: PlanStep, state: BlueprintState, event: StepEvent): string | null {
  if (event.type === "ask" && event.question.trim() === "") return "a question cannot be empty";
  if (event.type !== "start") return null;
  const blocker = earlierUnpassed(steps, steps.indexOf(step), state);
  return blocker ? `"${blocker.id}" has not passed yet` : null;
}

/** The state after `event` happens to step `stepId`, or why it cannot happen. */
export function applyEvent(steps: readonly PlanStep[], state: BlueprintState, stepId: string, event: StepEvent): TransitionResult {
  const step = steps.find((candidate) => candidate.id === stepId);
  if (!step) return { ok: false, reason: "unknown step" };
  const refused = stateProblems(steps, state)[0] ?? eventRefusal(steps, step, state, event);
  if (refused) return { ok: false, reason: refused };
  const current = state.steps[stepId] ?? freshStep();
  const transition = TRANSITIONS[`${current.status}:${event.type}`];
  if (!transition) return { ok: false, reason: `cannot ${event.type} a step that is ${current.status}` };
  return { ok: true, state: { steps: { ...state.steps, [stepId]: transition(step, current, event) } } };
}

// Statuses a gated step can only be in after someone approved it.
const PAST_THE_GATE: ReadonlySet<StepStatus> = new Set(["running", "awaiting-answer", "passed"]);

function stepProblems(step: PlanStep, stepState: StepState | undefined, earlierAllPassed: boolean): string[] {
  if (!stepState) return [`no state for step "${step.id}"`];
  const problems: string[] = [];
  if (stepState.status !== "pending" && !earlierAllPassed) problems.push(`"${step.id}" is ${stepState.status} before the steps ahead of it passed`);
  if (step.gates.length > 0 && !stepState.approved && PAST_THE_GATE.has(stepState.status))
    problems.push(`"${step.id}" is ${stepState.status} without approval`);
  if (stepState.status === "awaiting-answer" && !stepState.question) problems.push(`"${step.id}" awaits an answer to no question`);
  if (stepState.status === "passed" && !stepState.lastCheck?.ok) problems.push(`"${step.id}" passed without a passing check`);
  return problems;
}

/** Why a loaded state could not have been reached through applyEvent — empty when it could have. */
export function stateProblems(steps: readonly PlanStep[], state: BlueprintState): string[] {
  const known = new Set(steps.map((step) => step.id));
  const strays = Object.keys(state.steps)
    .filter((id) => !known.has(id))
    .map((id) => `state has unknown step "${id}"`);
  const perStep = steps.flatMap((step, index) =>
    stepProblems(
      step,
      state.steps[step.id],
      steps.slice(0, index).every((earlier) => state.steps[earlier.id]?.status === "passed"),
    ),
  );
  return [...strays, ...perStep];
}

/** The first step that has not passed — what the build is on now — or null when it is done. */
export const currentStep = (steps: readonly PlanStep[], state: BlueprintState): PlanStep | null =>
  steps.find((step) => state.steps[step.id]?.status !== "passed") ?? null;

export const WAIT_KINDS = ["approval", "answer", "failure"] as const;
export type WaitKind = (typeof WAIT_KINDS)[number];

const WAIT_KIND_BY_STATUS: Partial<Record<StepStatus, WaitKind>> = {
  "awaiting-approval": "approval",
  "awaiting-answer": "answer",
  failed: "failure",
};

/** Whether the build is stopped waiting for a person, and on what. */
export function waitingOn(steps: readonly PlanStep[], state: BlueprintState): { stepId: string; kind: WaitKind } | null {
  const step = currentStep(steps, state);
  const status = step ? state.steps[step.id]?.status : undefined;
  const kind = status ? WAIT_KIND_BY_STATUS[status] : undefined;
  return step && kind ? { stepId: step.id, kind } : null;
}
