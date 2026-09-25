// The interview's answers, written into the project before the first step runs: the spec step
// reads them, and every later step can see what the user actually said rather than a summary.
import path from "node:path";
import { writeFileAtomic } from "../files/atomic-write.js";
import type { HearingAnswers } from "../../common/blueprint/hearing.js";

export const ANSWERS_FILE = path.join(".blueprint", "answers.json");

export async function writeAnswers(projectDir: string, answers: HearingAnswers): Promise<void> {
  await writeFileAtomic(path.join(projectDir, ANSWERS_FILE), `${JSON.stringify(answers, null, 2)}\n`);
}
