import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectSessionsDir } from "./project-dir.js";

const located = new Map<string, string>();
const root = () => path.join(os.homedir(), ".claude", "projects");
const file = (dir: string, id: string) => path.join(dir, `${id}.jsonl`);

export function transcriptDir(id: string, cwd: string): string {
  const hinted = projectSessionsDir(cwd);
  if (existsSync(file(hinted, id))) {
    located.set(id, hinted);
    return hinted;
  }
  const remembered = located.get(id);
  if (remembered && existsSync(file(remembered, id))) return remembered;
  try {
    for (const entry of readdirSync(root())) {
      const dir = path.join(root(), entry);
      if (existsSync(file(dir, id))) {
        located.set(id, dir);
        return dir;
      }
    }
  } catch {
    /* missing projects root */
  }
  located.delete(id);
  return hinted;
}

export const transcriptFile = (id: string, cwd: string): string => file(transcriptDir(id, cwd), id);
export const forgetTranscriptLocation = (id: string): void => {
  located.delete(id);
};
