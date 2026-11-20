// Writing one memory file from the Library (#3331): the whole text, and only when the file is still
// the one the editor was opened on — the agent writes memory while it works, and a save over its
// change would lose it without a word.
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, rm, writeFile } from "node:fs/promises";
import { renameWithRetry } from "../../files/atomic-write.js";
import { readBoundedText } from "./file-history-read.js";
import { createKeySerializer } from "../../infra/async/serialize-per-key.js";

/** One change at a time per file in this server, so two naming one version cannot both pass the
 *  check: the second sees the first's text. Saves, deletes and their undoing all take their turn here. */
export const serialize = createKeySerializer();

/** A text's version: its SHA-256. The editor sends back the one it read; a different one on disk is a
 *  change made since. */
export const memoryVersion = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Whether a text read from disk is the file's own bytes: an invalid byte reads as U+FFFD, and writing
 *  that back would change the file without anyone having edited it — so such a file gets no version,
 *  and is never written here, whatever version a request names. */
export const isFaithfulText = (text: string): boolean => !text.includes("�");

export type MemoryWriteResult = { kind: "written"; version: string } | { kind: "conflict"; version: string | null } | { kind: "refused" };

export type Replace = (file: string, text: string, mode: number) => Promise<void>;

/** The new text written beside the file — created anew (`wx`), so it is ours — with the file's mode set
 *  on it, then renamed over the file. Nothing is done to the path after the rename: a link swapped in
 *  there by then is never followed. */
export async function replaceKeepingMode(file: string, text: string, mode: number): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, text, { flag: "wx", mode });
    await chmod(tmp, mode); // the umask may have narrowed it
    await renameWithRetry(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Writes `text` over `file` when its current text is still `expected`. A file that is gone is a
 *  conflict (someone removed it); one that cannot be read as text (a link, too large, binary) is
 *  refused. Saves from this server are one at a time per file; a change from another process landing
 *  between the check and the rename — an edit, or a removal the rename then undoes — is the window left. */
export function writeMemory(file: string, text: string, expected: string, replace: Replace = replaceKeepingMode): Promise<MemoryWriteResult> {
  return serialize(file, () => writeChecked(file, text, expected, replace));
}

async function writeChecked(file: string, text: string, expected: string, replace: Replace): Promise<MemoryWriteResult> {
  const current = await readBoundedText(file);
  if (current.text === null) return current.reason === "absent" ? { kind: "conflict", version: null } : { kind: "refused" };
  if (!isFaithfulText(current.text)) return { kind: "refused" };
  const now = memoryVersion(current.text);
  if (now !== expected) return { kind: "conflict", version: now };
  // The replacement is a new file: it would take the default mode, widening a memory kept private.
  await replace(file, text, (await lstat(file)).mode & 0o777);
  return { kind: "written", version: memoryVersion(text) };
}
