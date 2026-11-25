// The mark the Skills viewer's list shows beside each evaluated skill (#3467), read out of the evaluation folders
// rather than the catalog: a plugin can bring a thousand skills, and only the few with a folder have anything to say.
// A folder's name gives its skill's name and, for a project's skill, a hash of the project's directory; the
// directories terminals have run in are the ones that hash can be matched against.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isBaselineFor } from "../../../common/skillEval.js";
import { skillEvalMark, type SkillEvalMarkEntry } from "../../../common/skillEvalMark.js";
import { isRecord } from "../../../common/isRecord.js";
import { readSkillDoc, type SkillCatalogOptions, type SkillDocSource } from "../skills/skillCatalog.js";
import { newestRunWhere, readEvalSet, SKILL_EVAL_SET_FILE, skillEvalFolder, textHash } from "./evalStore.js";

/** Which project a folder belongs to: none for a name with no `@`, undefined when no directory known here has its hash. */
export function folderProject(folderName: string, projectDirs: readonly string[]): string | null | undefined {
  const at = folderName.lastIndexOf("@");
  if (at < 0) return null;
  const hash = folderName.slice(at + 1);
  return projectDirs.find((dir) => textHash(dir).slice(0, 8) === hash);
}

/** Where a skill of this name lives: a plugin's is named `plugin:slug`. */
export function skillSourceOf(id: string, projectDir: string | null): { source: SkillDocSource; slug: string } {
  if (projectDir !== null) return { source: { scope: "project", dir: projectDir }, slug: id };
  const colon = id.lastIndexOf(":");
  return colon < 0 ? { source: { scope: "user" }, slug: id } : { source: { scope: "plugin", plugin: id.slice(0, colon) }, slug: id.slice(colon + 1) };
}

/** The skill a set was written for, by its own `skill` field: a folder name loses a `:` and a project's directory. */
async function setSkillName(evalDir: string): Promise<string | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path.join(evalDir, SKILL_EVAL_SET_FILE), "utf8"));
    return isRecord(value) && typeof value.skill === "string" ? value.skill : null;
  } catch {
    return null;
  }
}

async function currentSkillHash(id: string, projectDir: string | null, where: SkillCatalogOptions): Promise<string | null> {
  const text = await readSkillDoc({ ...where, ...skillSourceOf(id, projectDir) });
  return text === null ? null : textHash(text);
}

async function markOfFolder(root: string, folderName: string, where: SkillCatalogOptions): Promise<SkillEvalMarkEntry | null> {
  const projectDir = folderProject(folderName, where.cwds);
  const evalDir = path.join(root, folderName);
  const id = projectDir === undefined ? null : await setSkillName(evalDir);
  // The folder must be the one this skill's evaluations go to, or the mark would be some other skill's.
  if (id === null || projectDir === undefined || skillEvalFolder(root, id, projectDir) !== evalDir) return null;
  const read = await readEvalSet(evalDir, id);
  const skillHash = read.kind === "ok" ? await currentSkillHash(id, projectDir, where) : null;
  if (read.kind !== "ok" || skillHash === null) return null;
  const baseline = await newestRunWhere(evalDir, (run) => isBaselineFor(run, read.hash, skillHash));
  return { id, projectDir, mark: skillEvalMark(baseline) };
}

/** A mark for every skill with a set of tasks that is still there; a folder that cannot be read is passed over. */
export async function readEvalMarks(root: string, where: SkillCatalogOptions): Promise<SkillEvalMarkEntry[]> {
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  const marks = await Promise.all(folders.filter((entry) => entry.isDirectory()).map((entry) => markOfFolder(root, entry.name, where)));
  return marks.filter((mark): mark is SkillEvalMarkEntry => mark !== null);
}
