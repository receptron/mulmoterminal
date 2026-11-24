// Waiting for a skill evaluation run started through the routes to end, for specs that start another after it.
import { activeRunId } from "../../server/backends/skillEval/evalRunner.js";
import { readRun } from "../../server/backends/skillEval/evalStore.js";
import type { SkillEvalRun } from "../../common/skillEval.js";

const POLLS = 300;
const POLL_MS = 10;

// A read that lands while the record is being replaced can come back empty on Windows: that is not an end.
// The server frees its one run slot only after the record says the run ended, so the next start waits for both.
export async function finishedSkillEvalRun(evalDir: string, id: string): Promise<SkillEvalRun | null> {
  for (let i = 0; i < POLLS; i++) {
    const run = await readRun(evalDir, id);
    if (run !== null && run.status !== "running" && activeRunId(evalDir) === null) return run;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return readRun(evalDir, id);
}
