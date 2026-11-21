// Which conversation wrote a memory (#3331): Claude Code writes memory with its own file tools, so a
// transcript records each write as a tool call naming the file. Pure: a record in, the memories it
// wrote out, each as `<slug>/<file>` — the folder and the name, which is what a memory is looked up by.
import { isRecord } from "../../../common/isRecord.js";
import { MEMORY_INDEX_FILE } from "../../../common/libraryMemory.js";

/** The tools that write a file's text. */
const WRITING_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit"]);

const MEMORY_FILE = /[\\/]projects[\\/]([A-Za-z0-9_-]{1,255})[\\/]memory[\\/](\w[\w.-]{0,199}\.md)$/;

/** `<slug>/<file>` for a path into a project's memory folder, or null — `MEMORY.md` is the index, not a
 *  memory. Only that spelling: on a case-sensitive disk `memory.md` is a memory of its own, and on one
 *  that is not, the list never shows the index as a memory, so a link recorded for it is never asked for. */
export function memoryWriteKey(filePath: string): string | null {
  const match = MEMORY_FILE.exec(filePath);
  const [, slug, file] = match ?? [];
  if (slug === undefined || file === undefined || file === MEMORY_INDEX_FILE) return null;
  return `${slug}/${file}`;
}

/** The memories an assistant record's tool calls wrote. */
export function memoryWritesOf(record: Record<string, unknown>): string[] {
  if (record.type !== "assistant" || !isRecord(record.message) || !Array.isArray(record.message.content)) return [];
  return record.message.content.flatMap((part) => {
    if (!isRecord(part) || part.type !== "tool_use" || typeof part.name !== "string" || !WRITING_TOOLS.has(part.name)) return [];
    const input = isRecord(part.input) ? part.input : {};
    const key = typeof input.file_path === "string" ? memoryWriteKey(input.file_path) : null;
    return key === null ? [] : [key];
  });
}
