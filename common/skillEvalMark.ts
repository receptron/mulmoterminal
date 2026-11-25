// What the Skills viewer's list says about each evaluated skill (#3467): the verdict of the measurement of its
// SKILL.md as it is now, on its tasks as they are now — or that it has tasks but that text was not measured.
// Shared because the server reads it out of the evaluation folders and the list matches it to the catalog.
import { z } from "zod";
import type { SkillEvalRun } from "./skillEval.js";
import { summarizeSkillEval } from "./skillEvalSummary.js";

export const skillEvalMarkSchema = z.enum(["helps", "hurts", "no-evidence", "pending", "unmeasured"]);
export type SkillEvalMark = z.infer<typeof skillEvalMarkSchema>;

export const skillEvalMarkEntrySchema = z.object({
  /** The name claude runs the skill by. */
  id: z.string(),
  /** The folder a project skill lives in; null for the user's and a plugin's. */
  projectDir: z.string().nullable(),
  mark: skillEvalMarkSchema,
});
export type SkillEvalMarkEntry = z.infer<typeof skillEvalMarkEntrySchema>;

/** The mark for a skill whose current text and tasks were measured by `baseline`, or not at all. Pure. */
export function skillEvalMark(baseline: SkillEvalRun | null): SkillEvalMark {
  return baseline === null ? "unmeasured" : summarizeSkillEval(baseline.cases, baseline.attempts, baseline.repeats).verdict;
}

/** The marks the list asks for are the ones that call for something: a skill that does not help, or was not measured. */
export const needsAttention = (mark: SkillEvalMark): boolean => mark === "hurts" || mark === "no-evidence" || mark === "unmeasured";

export const markKey = (id: string, projectDir: string | null): string => `${projectDir ?? ""}\n${id}`;

/** Whether the list's "needs attention" filter keeps a skill: its mark calls for something, or it has none and
 *  conversations use it — a skill nobody runs is not worth measuring first. */
export const wantsAttention = (mark: SkillEvalMark | null, used: boolean): boolean => (mark === null ? used : needsAttention(mark));
