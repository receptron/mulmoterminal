// Which conversation wrote a memory (#3331): Claude Code writes memory with its own file tools, so a
// transcript records each write as a tool call naming the file. Pure: a record in, the memory files it
// wrote out, each by the path it was written at — looked up by the path the server joins under its own
// projects root, so a folder elsewhere that only looks like one (`/tmp/projects/x/memory`) is no memory.
import { isRecord } from "../../../common/isRecord.js";
import { MEMORY_INDEX_FILE } from "../../../common/libraryMemory.js";

/** The tools that write a file's text. */
const WRITING_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit"]);

const MEMORY_FILE = /[\\/]projects[\\/][A-Za-z0-9_-]{1,255}[\\/]memory[\\/](\w[\w.-]{0,199}\.md)$/;

/** The path, when it is into a project's memory folder, or null — `MEMORY.md` is the index, not a
 *  memory. Only that spelling: on a case-sensitive disk `memory.md` is a memory of its own, and on one
 *  that is not, the list never shows the index as a memory, so a link recorded for it is never asked for. */
export function memoryWritePath(filePath: string): string | null {
  const [, file] = MEMORY_FILE.exec(filePath) ?? [];
  return file === undefined || file === MEMORY_INDEX_FILE ? null : filePath;
}

/** The memories an assistant record's tool calls wrote. */
export function memoryWritesOf(record: Record<string, unknown>): string[] {
  if (record.type !== "assistant" || !isRecord(record.message) || !Array.isArray(record.message.content)) return [];
  return record.message.content.flatMap((part) => {
    if (!isRecord(part) || part.type !== "tool_use" || typeof part.name !== "string" || !WRITING_TOOLS.has(part.name)) return [];
    const input = isRecord(part.input) ? part.input : {};
    const written = typeof input.file_path === "string" ? memoryWritePath(input.file_path) : null;
    return written === null ? [] : [written];
  });
}
