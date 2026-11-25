// Where skill evaluations live on disk (#3438). Each skill has a folder under the root: `cases.json` is
// the set the user approved, `files/<case>/` the files a case starts from, `runs/<id>.json` one record
// per run. Kept for good, so the same cases can be measured again after the skill, the model or Claude
// Code changes.
import { createHash } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import { access, mkdir, readdir, readFile, readlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { skillEvalDirName, skillEvalRunSchema, skillEvalSetSchema, type SkillEvalRun, type SkillEvalSet } from "../../../common/skillEval.js";
import { writeFileAtomic } from "../../files/atomic-write.js";
import { setHash, type StartingFile } from "./setHash.js";
import { isRecord } from "../../../common/isRecord.js";

const pathExists = (target: string): Promise<boolean> =>
  access(target).then(
    () => true,
    () => false,
  );

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

const startingFilesDir = (evalDir: string): string => path.join(evalDir, "files");
export const caseFilesDir = (evalDir: string, caseId: string): string => path.join(startingFilesDir(evalDir), caseId);
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

/** A file's digest, read a piece at a time: a starting file is meant to be small, but nothing holds it to that. */
async function fileDigest(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/** A link counts as where it points, not as what is there: following it could read anything on the machine. */
async function startingFile(dir: string, entry: Dirent, relative: string): Promise<StartingFile[]> {
  const full = path.join(dir, entry.name);
  if (entry.isSymbolicLink()) return [{ path: relative, kind: "link", digest: await readlink(full) }];
  if (entry.isFile()) return [{ path: relative, kind: "file", digest: await fileDigest(full) }];
  return entry.isDirectory() ? startingFilesUnder(full, relative) : [];
}

async function startingFilesUnder(dir: string, prefix: string): Promise<StartingFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(entries.map((entry) => startingFile(dir, entry, prefix === "" ? entry.name : `${prefix}/${entry.name}`)));
  return found.flat();
}

function parseSet(text: string, skillName: string, files: readonly StartingFile[]): EvalSetRead {
  const value = parseJson(text);
  if (value === NOT_JSON) return { kind: "invalid", error: `${SKILL_EVAL_SET_FILE} is not JSON` };
  const parsed = skillEvalSetSchema.safeParse(value);
  if (!parsed.success) return { kind: "invalid", error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  if (parsed.data.skill !== skillName) return { kind: "invalid", error: `${SKILL_EVAL_SET_FILE} is for "${parsed.data.skill}", not "${skillName}"` };
  return { kind: "ok", set: parsed.data, hash: setHash(text, files) };
}

const isMissing = (err: unknown): boolean => isRecord(err) && err.code === "ENOENT";

/** Every starting file of the set. Only a set with no `files/` folder at all has none: a folder that could not be
 *  read is not an empty one, and counting it as empty would take another set's runs for this one's. */
async function startingFiles(evalDir: string): Promise<StartingFile[]> {
  try {
    return await startingFilesUnder(startingFilesDir(evalDir), "");
  } catch (err) {
    if (isMissing(err) && !(await pathExists(startingFilesDir(evalDir)))) return [];
    throw err;
  }
}

/** The set and its hash, which covers the files its tasks start from as well as `cases.json` (#3491). */
export async function readEvalSet(evalDir: string, skillName: string): Promise<EvalSetRead> {
  const text = await readText(path.join(evalDir, SKILL_EVAL_SET_FILE));
  if (text === null) return { kind: "absent" };
  try {
    return parseSet(text, skillName, await startingFiles(evalDir));
  } catch (err) {
    // A set whose starting files cannot be read cannot be told apart from another set, so it is not offered as this one.
    return { kind: "invalid", error: `the files in ${startingFilesDir(evalDir)} could not be read: ${err instanceof Error ? err.message : String(err)}` };
  }
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
