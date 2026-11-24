// Where skill evaluations live on disk (#3438). Each skill has a folder under the root: `cases.json` is
// the set the user approved, `files/<case>/` the files a case starts from, `runs/<id>.json` one record
// per run. Kept for good, so the same cases can be measured again after the skill, the model or Claude
// Code changes.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { skillEvalDirName, skillEvalRunSchema, skillEvalSetSchema, type SkillEvalRun, type SkillEvalSet } from "../../../common/skillEval.js";
import { writeFileAtomic } from "../../files/atomic-write.js";

export const SKILL_EVAL_SET_FILE = "cases.json";
/** The newest runs listed for a skill; older ones stay on disk. */
export const LISTED_RUNS_MAX = 20;

export type EvalSetRead = { kind: "absent" } | { kind: "invalid"; error: string } | { kind: "ok"; set: SkillEvalSet; hash: string };

export const textHash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** A project's skill is run by its bare slug, so two projects' `weekly` would share one folder: the
 *  project's directory is part of the folder name. A user or plugin skill's name is already unique. */
export function skillEvalFolder(root: string, skillName: string, projectDir: string | null): string {
  const base = skillEvalDirName(skillName);
  return path.join(root, projectDir === null ? base : `${base}@${textHash(projectDir).slice(0, 8)}`);
}

export const caseFilesDir = (evalDir: string, caseId: string): string => path.join(evalDir, "files", caseId);
const runsDir = (evalDir: string): string => path.join(evalDir, "runs");

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

const NOT_JSON = Symbol("not json");

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

function parseSet(text: string, skillName: string): EvalSetRead {
  const value = parseJson(text);
  if (value === NOT_JSON) return { kind: "invalid", error: `${SKILL_EVAL_SET_FILE} is not JSON` };
  const parsed = skillEvalSetSchema.safeParse(value);
  if (!parsed.success) return { kind: "invalid", error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  if (parsed.data.skill !== skillName) return { kind: "invalid", error: `${SKILL_EVAL_SET_FILE} is for "${parsed.data.skill}", not "${skillName}"` };
  return { kind: "ok", set: parsed.data, hash: textHash(text) };
}

export async function readEvalSet(evalDir: string, skillName: string): Promise<EvalSetRead> {
  const text = await readText(path.join(evalDir, SKILL_EVAL_SET_FILE));
  return text === null ? { kind: "absent" } : parseSet(text, skillName);
}

export async function writeRun(evalDir: string, run: SkillEvalRun): Promise<void> {
  await mkdir(runsDir(evalDir), { recursive: true });
  await writeFileAtomic(path.join(runsDir(evalDir), `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`);
}

async function readRunFile(file: string): Promise<SkillEvalRun | null> {
  const text = await readText(file);
  if (text === null) return null;
  const parsed = skillEvalRunSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : null;
}

export const RUN_ID_RE = /^\d{13}-[a-f0-9]{8}$/;

export async function readRun(evalDir: string, runId: string): Promise<SkillEvalRun | null> {
  return RUN_ID_RE.test(runId) ? readRunFile(path.join(runsDir(evalDir), `${runId}.json`)) : null;
}

async function runIdsNewestFirst(evalDir: string): Promise<string[]> {
  const names = await readdir(runsDir(evalDir)).catch((): string[] => []);
  const ids = names
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter((id) => RUN_ID_RE.test(id));
  // A run id starts with its start time, zero-padded, so the newest sorts last.
  return ids.toSorted((a, b) => b.localeCompare(a));
}

/** The newest run `accept` takes, looking past the listed ones; read one at a time, since it is usually recent. */
export async function newestRunWhere(evalDir: string, accept: (run: SkillEvalRun) => boolean): Promise<SkillEvalRun | null> {
  for (const id of await runIdsNewestFirst(evalDir)) {
    const run = await readRun(evalDir, id);
    if (run !== null && accept(run)) return run;
  }
  return null;
}

/** The newest runs first. A file that does not parse is passed over. */
export async function listRuns(evalDir: string): Promise<SkillEvalRun[]> {
  const newest = (await runIdsNewestFirst(evalDir)).slice(0, LISTED_RUNS_MAX);
  const runs = await Promise.all(newest.map((id) => readRun(evalDir, id)));
  return runs.filter((run): run is SkillEvalRun => run !== null);
}
