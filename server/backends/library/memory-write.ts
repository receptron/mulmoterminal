// Writing one memory file from the Library (#3331): the whole text, and only when the file is still
// the one the editor was opened on — the agent writes memory while it works, and a save over its
// change would lose it without a word.
import { createHash } from "node:crypto";
import { chmod, lstat } from "node:fs/promises";
import { writeFileAtomic } from "../../files/atomic-write.js";
import { readBoundedText } from "./file-history-read.js";
import { createKeySerializer } from "../../infra/async/serialize-per-key.js";

/** One save at a time per file in this server, so two saves naming one version cannot both pass the
 *  check: the second sees the first's text. */
const serialize = createKeySerializer();

/** A text's version: its SHA-256. The editor sends back the one it read; a different one on disk is a
 *  change made since. */
export const memoryVersion = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Whether a text read from disk is the file's own bytes: an invalid byte reads as U+FFFD, and writing
 *  that back would change the file without anyone having edited it — so such a file gets no version,
 *  and is never written here, whatever version a request names. */
export const isFaithfulText = (text: string): boolean => !text.includes("\uFFFD");

export type MemoryWriteResult = { kind: "written"; version: string } | { kind: "conflict"; version: string | null } | { kind: "refused" };

/** Writes `text` over `file` when its current text is still `expected`. A file that is gone is a
 *  conflict (someone removed it); one that cannot be read as text (a link, too large, binary) is
 *  refused. Saves from this server are one at a time per file; a change from another process landing
 *  between the check and the rename — an edit, or a removal the rename then undoes — is the window left. */
export function writeMemory(
  file: string,
  text: string,
  expected: string,
  write: (file: string, text: string) => Promise<void> = writeFileAtomic,
): Promise<MemoryWriteResult> {
  return serialize(file, () => writeChecked(file, text, expected, write));
}

async function writeChecked(
  file: string,
  text: string,
  expected: string,
  write: (file: string, text: string) => Promise<void> = writeFileAtomic,
): Promise<MemoryWriteResult> {
  const current = await readBoundedText(file);
  if (current.text === null) return current.reason === "absent" ? { kind: "conflict", version: null } : { kind: "refused" };
  if (!isFaithfulText(current.text)) return { kind: "refused" };
  const now = memoryVersion(current.text);
  if (now !== expected) return { kind: "conflict", version: now };
  // The replacement is a new file: it would take the default mode, widening a memory kept private.
  const mode = (await lstat(file)).mode & 0o777;
  await write(file, text);
  await chmod(file, mode);
  return { kind: "written", version: memoryVersion(text) };
}
