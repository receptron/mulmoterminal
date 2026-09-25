// The interview a usecase pack asks before a spec is written. Each question carries WHY it is
// asked, because the answer decides something that is expensive to change later (a Firestore
// region cannot be moved), and a non-engineer answers better when told what rides on it.
import { z } from "zod";

export const HEARING_KINDS = ["text", "select", "multiselect", "number", "boolean"] as const;

const questionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z]\w{0,63}$/),
  label: z.string().min(1),
  why: z.string().min(1),
  kind: z.enum(HEARING_KINDS),
  options: z.array(z.string().min(1)).optional(),
  required: z.boolean().default(true),
  // Asked only when an earlier answer equals this value.
  showIf: z.object({ id: z.string(), equals: z.union([z.string(), z.boolean(), z.number()]) }).optional(),
});

export const hearingSchema = z.object({ questions: z.array(questionSchema).min(1) }).superRefine((hearing, ctx) => {
  hearingProblems(hearing.questions).forEach((message) => ctx.addIssue({ code: "custom", message }));
});

export type HearingQuestion = z.infer<typeof questionSchema>;
export type Hearing = z.infer<typeof hearingSchema>;
export type HearingAnswer = string | number | boolean | string[];
export type HearingAnswers = Record<string, HearingAnswer>;

const needsOptions = (question: HearingQuestion): boolean => question.kind === "select" || question.kind === "multiselect";

function questionProblems(question: HearingQuestion, earlier: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  if (earlier.has(question.id)) problems.push(`duplicate question id "${question.id}"`);
  if (needsOptions(question) && !question.options?.length) problems.push(`"${question.id}" is a ${question.kind} with no options`);
  if (question.showIf && !earlier.has(question.showIf.id)) problems.push(`"${question.id}" depends on "${question.showIf.id}", which is not asked before it`);
  return problems;
}

/** Structural problems a schema alone cannot see: duplicate ids, a choice with no options,
 *  a condition on a question that is not asked earlier. */
export function hearingProblems(questions: readonly HearingQuestion[]): string[] {
  const seen = new Set<string>();
  return questions.flatMap((question) => {
    const problems = questionProblems(question, seen);
    seen.add(question.id);
    return problems;
  });
}

const isBlank = (answer: HearingAnswer | undefined): boolean =>
  answer === undefined || (typeof answer === "string" && answer.trim() === "") || (Array.isArray(answer) && answer.length === 0);

const conditionHolds = (question: HearingQuestion, answers: HearingAnswers, asked: ReadonlySet<string>): boolean =>
  !question.showIf || (asked.has(question.showIf.id) && answers[question.showIf.id] === question.showIf.equals);

/** The questions that apply under the current answers. A condition holds only when the question it
 *  names is itself asked, so a stale answer to a question no longer asked opens nothing. */
export function askedQuestions(hearing: Hearing, answers: HearingAnswers): HearingQuestion[] {
  const asked = new Set<string>();
  return hearing.questions.filter((question) => {
    const applies = conditionHolds(question, answers, asked);
    if (applies) asked.add(question.id);
    return applies;
  });
}

/** The questions still to put to the user: asked under the current answers, required, and blank.
 *  A spec the user already supplied fills `answers` first, so only its gaps are asked. */
export const unansweredQuestions = (hearing: Hearing, answers: HearingAnswers): HearingQuestion[] =>
  askedQuestions(hearing, answers).filter((question) => question.required && isBlank(answers[question.id]));
