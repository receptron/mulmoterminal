import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Write a state file so a crash mid-write can't leave a truncated one behind: write a
// unique temp then rename (atomic on POSIX + Windows), mkdir -p the parent first. The
// unique name is what lets two writers use this concurrently without trampling a temp.
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, filePath);
}
