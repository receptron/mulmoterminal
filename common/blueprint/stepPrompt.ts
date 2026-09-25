// The prompt a step's session starts with. Everything the agent needs to act without guessing:
// the skill to follow, what was already asked and answered, why the last attempt failed, and the
// one way it may stop to ask a person.
import type { PlanStep } from "./plan.js";
import type { StepState } from "./state.js";

// Enough of a failing check's output to act on; a build log can run far longer.
export const CHECK_OUTPUT_PROMPT_CHARS = 4000;

export interface StepPromptInput {
  step: PlanStep;
  /** Absolute path of the step's SKILL.md. */
  skillFile: string;
  stepState: StepState | undefined;
  /** A shell command that asks the user `$QUESTION` — the executor fills in the run and step. */
  askCommand: string;
}

const tail = (text: string, chars: number): string => (text.length > chars ? `…${text.slice(-chars)}` : text);

function answeredSection(stepState: StepState | undefined): string[] {
  const answers = stepState?.answers ?? [];
  if (answers.length === 0) return [];
  return ["", "Already asked and answered — do not ask these again:", ...answers.map(({ question, answer }) => `- Q: ${question}\n  A: ${answer}`)];
}

function failureSection(stepState: StepState | undefined): string[] {
  const check = stepState?.lastCheck;
  if (!check || check.ok) return [];
  return ["", "The previous attempt did not pass its check. Its output:", "```", tail(check.output, CHECK_OUTPUT_PROMPT_CHARS), "```", "Fix what it reports."];
}

export function stepPrompt({ step, skillFile, stepState, askCommand }: StepPromptInput): string {
  return [
    `Blueprint step "${step.id}": ${step.title}.`,
    step.description,
    "",
    `Read and follow ${skillFile}. Read .blueprint/spec.md for the agreed specification.`,
    "",
    "If you need a decision from the user, run this and then stop — do not guess:",
    `  QUESTION='your question' ${askCommand}`,
    "",
    `When the work is done, stop. The executor then runs the step's check itself: ${step.check}`,
    ...answeredSection(stepState),
    ...failureSection(stepState),
  ].join("\n");
}
