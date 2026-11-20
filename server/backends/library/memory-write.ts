// Writing one memory file from the Library (#3331): the whole text, and only when the file is still
// the one the editor was opened on — the agent writes memory while it works, and a save over its
// change would lose it without a word.
import { createHash } from "node:crypto";
import { writeFileAtomic } from "../../files/atomic-write.js";
import { readBoundedText } from "./file-history-read.js";

/** A text's version: its SHA-256. The editor sends back the one it read; a different one on disk is a
 *  change made since. */
export const memoryVersion = (text: string): string => createHash("sha256").update(text).digest("hex");

export type MemoryWriteResult = { kind: "written"; version: string } | { kind: "conflict"; version: string | null } | { kind: "refused" };

/** Writes `text` over `file` when its current text is still `expected`. A file that is gone is a
 *  conflict (someone removed it); one that cannot be read as text (a link, too large, binary) is
 *  refused. The check and the write are two calls: a change landing between them is the window left. */
export async function writeMemory(
  file: string,
  text: string,
  expected: string,
  write: (file: string, text: string) => Promise<void> = writeFileAtomic,
): Promise<MemoryWriteResult> {
  const current = await readBoundedText(file);
  if (current.text === null) return current.reason === "absent" ? { kind: "conflict", version: null } : { kind: "refused" };
  const now = memoryVersion(current.text);
  if (now !== expected) return { kind: "conflict", version: now };
  await write(file, text);
  return { kind: "written", version: memoryVersion(text) };
}
