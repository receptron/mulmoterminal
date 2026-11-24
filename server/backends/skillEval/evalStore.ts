// Where skill evaluations live on disk (#3438): `<root>/<skill>/cases.json` is the set the user
// approved, `<root>/<skill>/files/<case>/` the files a case starts from, `<root>/<skill>/runs/<id>.json`
// one record per run. Kept for good, so the same cases can be measured again after the skill, the
// model or Claude Code changes.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { skillEvalDirName, skillEvalRunSchema, skillEvalSetSchema, type SkillEvalRun, type SkillEvalSet } from "../../../common/skillEval.js";
import { writeFileAtomic } from "../../files/atomic-write.js";

export const SKILL_EVAL_SET_FILE = "cases.json";
/** The newest runs listed for a skill; older ones stay on disk. */
export const LISTED_RUNS_MAX = 20;

export type EvalSetRead = { kind: "absent" } | { kind: "invalid"; error: string } | { kind: "ok"; set: SkillEvalSet; hash: string };

export const skillEvalDir = (root: string, skillId: string): string => path.join(root, skillEvalDirName(skillId));
export const caseFilesDir = (root: string, skillId: string, caseId: string): string => path.join(skillEvalDir(root, skillId), "files", caseId);
const runsDir = (root: string, skillId: string): string => path.join(skillEvalDir(root, skillId), "runs");

export const textHash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

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

function parseSet(text: string, skillId: string): EvalSetRead {
  const value = parseJson(text);
  if (value === NOT_JSON) return { kind: "invalid", error: `${SKILL_EVAL_SET_FILE} is not JSON` };
  const parsed = skillEvalSetSchema.safeParse(value);
  if (!parsed.success) return { kind: "invalid", error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  if (parsed.data.skill !== skillId) return { kind: "invalid", error: `${SKILL_EVAL_SET_FILE} is for "${parsed.data.skill}", not "${skillId}"` };
  return { kind: "ok", set: parsed.data, hash: textHash(text) };
}

export async function readEvalSet(root: string, skillId: string): Promise<EvalSetRead> {
  const text = await readText(path.join(skillEvalDir(root, skillId), SKILL_EVAL_SET_FILE));
  return text === null ? { kind: "absent" } : parseSet(text, skillId);
}

export async function writeRun(root: string, run: SkillEvalRun): Promise<void> {
  const dir = runsDir(root, run.skill);
  await mkdir(dir, { recursive: true });
  await writeFileAtomic(path.join(dir, `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`);
}

async function readRunFile(file: string): Promise<SkillEvalRun | null> {
  const text = await readText(file);
  if (text === null) return null;
  const parsed = skillEvalRunSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : null;
}

export const RUN_ID_RE = /^\d{13}-[a-f0-9]{8}$/;

export async function readRun(root: string, skillId: string, runId: string): Promise<SkillEvalRun | null> {
  return RUN_ID_RE.test(runId) ? readRunFile(path.join(runsDir(root, skillId), `${runId}.json`)) : null;
}

/** The newest runs first. A file that does not parse is passed over. */
export async function listRuns(root: string, skillId: string): Promise<SkillEvalRun[]> {
  const names = await readdir(runsDir(root, skillId)).catch((): string[] => []);
  const ids = names
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter((id) => RUN_ID_RE.test(id));
  // A run id starts with its start time, zero-padded, so the newest sorts last.
  const newest = ids.toSorted((a, b) => b.localeCompare(a)).slice(0, LISTED_RUNS_MAX);
  const runs = await Promise.all(newest.map((id) => readRun(root, skillId, id)));
  return runs.filter((run): run is SkillEvalRun => run !== null);
}
