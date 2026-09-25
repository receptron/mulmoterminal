// One build of a blueprint: which project, which two packs, the composed steps, and the
// executor's own bookkeeping. Read by the server (to drive the build) and by the UI (to show it),
// so the wire shape lives here. The step STATE is kept beside it, in its own file, because only
// `applyEvent` may change it.
import { z } from "zod";
import { planStepSchema } from "./plan.js";
import { blueprintStateSchema } from "./state.js";

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
  sessions: z.array(z.object({ stepId: z.string(), sessionId: z.string(), atMs: z.number() })).default([]),
  createdAtMs: z.number(),
});

export type BlueprintRun = z.infer<typeof blueprintRunSchema>;

/** What `/api/blueprints/runs/:id` answers with. */
export const blueprintRunViewSchema = z.object({ run: blueprintRunSchema, state: blueprintStateSchema });
export type BlueprintRunView = z.infer<typeof blueprintRunViewSchema>;
