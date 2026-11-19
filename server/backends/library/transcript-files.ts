// Every claude transcript under the projects root (#3328): `<project>/<session>.jsonl`, and each
// subagent's `<project>/<session>/subagents/<agent>.jsonl`, which names its parent by the directory.
import { promises as fs } from "node:fs";
import path from "node:path";

export interface TranscriptFile {
  path: string;
  id: string;
  parentId: string | null;
}

const JSONL = ".jsonl";

async function entriesOf(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // gone between the walk and the read, or not a directory we may open
  }
}

const jsonlIn = async (dir: string, parentId: string | null): Promise<TranscriptFile[]> =>
  (await entriesOf(dir))
    .filter((entry) => entry.isFile() && entry.name.endsWith(JSONL))
    .map((entry) => ({ path: path.join(dir, entry.name), id: entry.name.slice(0, -JSONL.length), parentId }));

async function transcriptsInProject(projectDir: string): Promise<TranscriptFile[]> {
  const entries = await entriesOf(projectDir);
  const sessions = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const subagents = await Promise.all(sessions.map((session) => jsonlIn(path.join(projectDir, session, "subagents"), session)));
  return [...(await jsonlIn(projectDir, null)), ...subagents.flat()];
}

export async function listTranscriptFiles(projectsRoot: string): Promise<TranscriptFile[]> {
  const projects = (await entriesOf(projectsRoot)).filter((entry) => entry.isDirectory());
  const found: TranscriptFile[] = [];
  for (const project of projects) found.push(...(await transcriptsInProject(path.join(projectsRoot, project.name))));
  return found;
}
