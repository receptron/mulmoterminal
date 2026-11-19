// Every claude transcript under the projects root (#3328): `<project>/<session>.jsonl`, and each
// subagent's `<project>/<session>/subagents/<agent>.jsonl`, which names its parent by the directory.
import { promises as fs } from "node:fs";
import path from "node:path";
import { isRecord } from "../../../common/isRecord.js";

export interface TranscriptFile {
  path: string;
  id: string;
  parentId: string | null;
}

const JSONL = ".jsonl";

export interface TranscriptListing {
  files: TranscriptFile[];
  /** False when some directory could not be read: its files are missing from `files`, not gone. */
  complete: boolean;
}

// A directory that does not exist is empty — most sessions have no `subagents`. Any other failure
// leaves the walk incomplete, which the caller must not read as "these files were deleted".
async function entriesOf(dir: string, unreadable: string[]) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (!(isRecord(err) && err.code === "ENOENT")) unreadable.push(dir);
    return [];
  }
}

const jsonlIn = async (dir: string, parentId: string | null, unreadable: string[]): Promise<TranscriptFile[]> =>
  (await entriesOf(dir, unreadable))
    .filter((entry) => entry.isFile() && entry.name.endsWith(JSONL))
    .map((entry) => ({ path: path.join(dir, entry.name), id: entry.name.slice(0, -JSONL.length), parentId }));

async function transcriptsInProject(projectDir: string, unreadable: string[]): Promise<TranscriptFile[]> {
  const entries = await entriesOf(projectDir, unreadable);
  const sessions = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const subagents = await Promise.all(sessions.map((session) => jsonlIn(path.join(projectDir, session, "subagents"), session, unreadable)));
  const top = entries.filter((entry) => entry.isFile() && entry.name.endsWith(JSONL));
  return [...top.map((entry) => ({ path: path.join(projectDir, entry.name), id: entry.name.slice(0, -JSONL.length), parentId: null })), ...subagents.flat()];
}

export async function listTranscriptFiles(projectsRoot: string): Promise<TranscriptListing> {
  const unreadable: string[] = [];
  const projects = (await entriesOf(projectsRoot, unreadable)).filter((entry) => entry.isDirectory());
  const files: TranscriptFile[] = [];
  for (const project of projects) files.push(...(await transcriptsInProject(path.join(projectsRoot, project.name), unreadable)));
  return { files, complete: unreadable.length === 0 };
}
