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
  /** The two packs: their spec/ and security/ templates are what a step writes from. */
  packDirs: { base: string; usecase: string };
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

export function stepPrompt({ step, skillFile, packDirs, stepState, askCommand }: StepPromptInput): string {
  return [
    `Blueprint step "${step.id}": ${step.title}.`,
    step.description,
    "",
    `Read and follow ${skillFile}. Read .blueprint/spec.md for the agreed specification.`,
    `The user's interview answers are in .blueprint/answers.json. Base pack: ${packDirs.base}. Usecase pack: ${packDirs.usecase}.`,
    "",
    "If you need a decision from the user, run this and then stop — do not guess:",
    `  QUESTION='your question' ${askCommand}`,
    `The user is not an engineer. When they must do something by hand — a console setting, a sign-in, trying the app — use the matching guide in ${packDirs.base}/guides or ${packDirs.usecase}/guides: put its steps in your question with the {{…}} placeholders filled in, rather than a bare link. The question is shown as Markdown.`,
    "",
    `When the work is done, stop. The executor then runs the step's check itself: ${step.check}`,
    "Finish everything within this turn: leave no background task or subagent running when you stop — this session is closed when its turn ends, and the next step may start in the same folder.",
    ...answeredSection(stepState),
    ...failureSection(stepState),
  ].join("\n");
}
