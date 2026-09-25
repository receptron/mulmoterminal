// One build of a blueprint: which project, which two packs, the composed steps, and the
// executor's own bookkeeping. Read by the server (to drive the build) and by the UI (to show it),
// so the wire shape lives here. The step STATE is kept beside it, in its own file, because only
// `applyEvent` may change it.
import { z } from "zod";
import { planStepSchema } from "./plan.js";
import { blueprintStateSchema, currentStep, waitingOn, STEP_STATUSES, WAIT_KINDS, type BlueprintState } from "./state.js";

export const RUN_ID_RE = /^[a-z0-9-]{8,64}$/;

const composedStepSchema = planStepSchema.extend({ origin: z.enum(["base", "usecase"]) });

export const blueprintRunSchema = z.object({
  id: z.string().regex(RUN_ID_RE),
  projectDir: z.string().min(1),
  basePackDir: z.string().min(1),
  usecasePackDir: z.string().min(1),
  steps: z.array(composedStepSchema).min(1),
  // Checks that failed for a step since a person last retried it; what stops a failing check from
  // looping forever.
  failedChecks: z.record(z.string(), z.number().int().nonnegative()).default({}),
  // The session working on the current step, if one is. Its turn ending is what triggers a check.
  activeSessionId: z.string().nullable().default(null),
  // `answersAtStart`: how many answers the step had when the session began, so an answer that came
  // DURING it is told apart by count — a timestamp can tie with the spawn to the millisecond.
  sessions: z
    .array(z.object({ stepId: z.string(), sessionId: z.string(), atMs: z.number(), answersAtStart: z.number().int().nonnegative().optional() }))
    .default([]),
  createdAtMs: z.number(),
});

export type BlueprintRun = z.infer<typeof blueprintRunSchema>;

/** What `/api/blueprints/runs/:id` answers with. */
export const blueprintRunViewSchema = z.object({ run: blueprintRunSchema, state: blueprintStateSchema });
export type BlueprintRunView = z.infer<typeof blueprintRunViewSchema>;

/** One line of the build list: where it is, and whether it is waiting for a person. */
export const blueprintRunSummarySchema = z.object({
  id: z.string(),
  projectDir: z.string(),
  createdAtMs: z.number(),
  current: z.object({ stepId: z.string(), title: z.string(), status: z.enum(STEP_STATUSES) }).nullable(),
  waitingOn: z.enum(WAIT_KINDS).nullable(),
  passed: z.number(),
  total: z.number(),
});
export type BlueprintRunSummary = z.infer<typeof blueprintRunSummarySchema>;

export function summarizeRun(run: BlueprintRun, state: BlueprintState): BlueprintRunSummary {
  const step = currentStep(run.steps, state);
  const status = step ? (state.steps[step.id]?.status ?? "pending") : null;
  return {
    id: run.id,
    projectDir: run.projectDir,
    createdAtMs: run.createdAtMs,
    current: step && status ? { stepId: step.id, title: step.title, status } : null,
    waitingOn: waitingOn(run.steps, state)?.kind ?? null,
    passed: run.steps.filter((entry) => state.steps[entry.id]?.status === "passed").length,
    total: run.steps.length,
  };
}
