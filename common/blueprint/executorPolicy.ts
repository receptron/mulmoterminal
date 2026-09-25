// What the executor does next, decided from the plan and the state alone. The executor itself is
// a loop around this: it does what this says, records the outcome through `applyEvent`, and asks
// again — so every branch here is reachable in a test without spawning anything.
import type { PlanStep } from "./plan.js";
import { currentStep, type BlueprintState } from "./state.js";

// Failed checks one step may have before the build stops for a person. Enough for an agent to read
// its own check output and fix it; small enough that a step it cannot fix does not burn turn after
// turn. Sessions that stopped to ask are not failures and do not count.
export const MAX_FAILED_CHECKS = 3;

export type ExecutorAction =
  | { kind: "done" }
  | { kind: "start"; stepId: string }
  | { kind: "spawn"; stepId: string }
  | { kind: "retry"; stepId: string }
  | { kind: "wait"; stepId: string; on: "approval" | "answer" | "failure" | "agent" };

export interface ExecutorInputs {
  steps: readonly PlanStep[];
  state: BlueprintState;
  failedChecks: Readonly<Record<string, number>>;
  sessionActive: boolean;
}

function forFailed(stepId: string, inputs: ExecutorInputs): ExecutorAction {
  const stepState = inputs.state.steps[stepId];
  // Only a failed CHECK is retried automatically. A rejected gate is a person's decision.
  const checkFailed = stepState?.lastCheck?.ok === false && stepState.reason === "check failed";
  const failures = inputs.failedChecks[stepId] ?? 0;
  return checkFailed && failures < MAX_FAILED_CHECKS ? { kind: "retry", stepId } : { kind: "wait", stepId, on: "failure" };
}

export function nextAction(inputs: ExecutorInputs): ExecutorAction {
  const step = currentStep(inputs.steps, inputs.state);
  if (!step) return { kind: "done" };
  const status = inputs.state.steps[step.id]?.status ?? "pending";
  if (status === "pending") return { kind: "start", stepId: step.id };
  if (status === "awaiting-approval") return { kind: "wait", stepId: step.id, on: "approval" };
  if (status === "awaiting-answer") return { kind: "wait", stepId: step.id, on: "answer" };
  if (status === "running") return inputs.sessionActive ? { kind: "wait", stepId: step.id, on: "agent" } : { kind: "spawn", stepId: step.id };
  return forFailed(step.id, inputs);
}
