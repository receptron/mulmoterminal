// The build plan: an ordered list of steps, each with the skill that does it, the check that
// decides it is done, and the gates that must be approved before it may start. Steps run strictly
// in order — a non-engineer follows one line of progress, not a graph.
import { z } from "zod";
import { isContainedRelativePath } from "./relativePath.js";

const SKILL_SEGMENT_RE = /^[a-z0-9][a-z0-9_-]*$/;

// Operations the agent may never decide on its own. A step declaring one cannot start until a
// human approves it, whatever the agent thinks of the risk. `review` is the person reading what the
// steps before it produced — the written spec above all — before anything is built on it.
export const BLUEPRINT_GATES = ["review", "billing", "deploy-production", "delete", "credential"] as const;
export type BlueprintGate = (typeof BLUEPRINT_GATES)[number];

const stepId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export const planStepSchema = z.object({
  id: stepId,
  title: z.string().min(1),
  description: z.string().default(""),
  // Skill directory, relative to the pack that declares the step — and inside it: no `..`, no
  // leading slash, so a pack installed from elsewhere cannot point its agent at another file.
  skill: z.string().refine((value) => isContainedRelativePath(value, SKILL_SEGMENT_RE), "skill must be a path inside the pack"),
  // Shell command run in the project directory; exit 0 means the step is done. The agent's own
  // claim that it finished is never what decides. The executor sets BLUEPRINT_BASE and
  // BLUEPRINT_USECASE to the two pack directories, so a check can call a script shipped in either.
  check: z.string().min(1),
  gates: z.array(z.enum(BLUEPRINT_GATES)).default([]),
});

// A usecase step is spliced into the base plan after the step it names; none means at the end.
// `bases` limits it to those bases: a usecase that works on several builds differently on each.
export const usecaseStepSchema = planStepSchema.extend({ insertAfter: stepId.optional(), bases: z.array(stepId).min(1).optional() });

export const basePlanSchema = z.object({ steps: z.array(planStepSchema).min(1) });
export const usecaseStepsSchema = z.object({ steps: z.array(usecaseStepSchema).default([]) });

export type PlanStep = z.infer<typeof planStepSchema>;
export type UsecaseStep = z.infer<typeof usecaseStepSchema>;
export type BasePlan = z.infer<typeof basePlanSchema>;
export type UsecaseSteps = z.infer<typeof usecaseStepsSchema>;

// Which pack a composed step came from: its `skill` path is relative to that pack.
export type StepOrigin = "base" | "usecase";
export type ComposedStep = PlanStep & { origin: StepOrigin };

export type ComposeResult = { ok: true; steps: ComposedStep[] } | { ok: false; problems: string[] };

// zod strips keys the schema does not name, which is exactly dropping the anchor.
const withoutAnchor = (step: UsecaseStep): PlanStep => planStepSchema.parse(step);

const fromBase = (step: PlanStep): ComposedStep => ({ ...step, origin: "base" });
const fromUsecase = (step: UsecaseStep): ComposedStep => ({ ...withoutAnchor(step), origin: "usecase" });

function duplicateIds(steps: readonly PlanStep[]): string[] {
  const seen = new Set<string>();
  return steps.flatMap((step) => {
    const duplicate = seen.has(step.id);
    seen.add(step.id);
    return duplicate ? [`duplicate step id "${step.id}"`] : [];
  });
}

function missingAnchors(base: readonly PlanStep[], extra: readonly UsecaseStep[]): string[] {
  const ids = new Set(base.map((step) => step.id));
  return extra.flatMap((step) =>
    step.insertAfter && !ids.has(step.insertAfter) ? [`"${step.id}" is inserted after "${step.insertAfter}", which the base plan does not have`] : [],
  );
}

function splice(base: readonly PlanStep[], extra: readonly UsecaseStep[]): ComposedStep[] {
  const after = (id: string | undefined): ComposedStep[] => extra.filter((step) => step.insertAfter === id).map(fromUsecase);
  return [...base.flatMap((step) => [fromBase(step), ...after(step.id)]), ...after(undefined)];
}

// Required, not optional: a caller that forgot the base would silently get every base's steps.
const forBase = (steps: readonly UsecaseStep[], baseSlug: string): UsecaseStep[] => steps.filter((step) => !step.bases || step.bases.includes(baseSlug));

/** The base plan with the usecase's steps for this base spliced in, or every reason it cannot be built. */
export function composePlan(base: BasePlan, usecase: UsecaseSteps, baseSlug: string): ComposeResult {
  const steps = forBase(usecase.steps, baseSlug);
  const problems = [...missingAnchors(base.steps, steps), ...duplicateIds([...base.steps, ...steps.map(withoutAnchor)])];
  return problems.length > 0 ? { ok: false, problems } : { ok: true, steps: splice(base.steps, steps) };
}
