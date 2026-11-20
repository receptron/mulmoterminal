// Claude Code's auto memory as the Library reads it (#3331): each project's `memory/` folder, its
// `MEMORY.md` index, and the memory files with their frontmatter. Pure.
import { isRecord } from "./isRecord.js";

/** How much of `MEMORY.md` Claude Code loads, as its own source has it (2.1.292: 200 lines, 25,000
 *  bytes). Past either, the rest of the index is not in the agent's context. */
export const MEMORY_INDEX_LINES_MAX = 200;
export const MEMORY_INDEX_BYTES_MAX = 25_000;
/** The index's own name in a memory folder. */
export const MEMORY_INDEX_FILE = "MEMORY.md";

/** The folder Claude Code keeps a directory's data under: every character outside `[A-Za-z0-9_-]`
 *  becomes `-` (its own rule, so a directory is matched to its memory without guessing). */
export const projectSlug = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9\-_]/g, "-") || "unknown";

export interface LibraryMemoryFile {
  /** The file's name in the folder. */
  file: string;
  /** The frontmatter `name`, or null when it has none. */
  name: string | null;
  description: string | null;
  /** `metadata.type` (user, feedback, project, reference), or null. */
  type: string | null;
  updatedAt: number;
}

export interface LibraryMemoryProject {
  slug: string;
  /** The directory the folder belongs to, when a conversation there tells it; else null. */
  cwd: string | null;
  /** The index's size against what is loaded; null when the folder has no index. */
  index: { lines: number; bytes: number } | null;
  files: LibraryMemoryFile[];
}

export interface MemoryFrontmatter {
  /** Top-level `key: value` lines, quotes taken off. */
  fields: Record<string, string>;
  /** The `metadata:` block's `key: value` lines. */
  metadata: Record<string, string>;
  body: string;
}

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : trimmed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'") ? trimmed.slice(1, -1).replaceAll("''", "'") : trimmed;
};

const KEY_VALUE = /^([A-Za-z_][\w-]*):(.*)$/;

/** The frontmatter between the opening `---` and the next one, as the memory files write it: flat
 *  keys and one `metadata:` block indented under them. No frontmatter: all of it is body. */
export function parseMemoryFrontmatter(text: string): MemoryFrontmatter {
  // A byte-order mark (a file saved by some Windows editors) would hide the opening `---`.
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  // The closing delimiter is a line of exactly `---` (a `---draft` line inside is not one), at the
  // end of the file or followed by a newline.
  const close = normalized.startsWith("---\n") ? /\n---(?:\n|$)/.exec(normalized.slice(3)) : null;
  const end = close === null ? -1 : close.index + 3;
  if (end === -1) return { fields: {}, metadata: {}, body: text };
  const fields: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  let inMetadata = false;
  normalized
    .slice(4, end)
    .split("\n")
    .forEach((line) => {
      const nested = /^\s+/.test(line);
      const match = KEY_VALUE.exec(line.trim());
      if (!match) return;
      const [, key = "", value = ""] = match;
      if (!nested) inMetadata = key === "metadata" && value.trim() === "";
      if (nested && inMetadata) metadata[key] = unquote(value);
      else if (!nested && !inMetadata) fields[key] = unquote(value);
    });
  return { fields, metadata, body: normalized.slice(end + 5) };
}

const isNullableString = (value: unknown): boolean => value === null || typeof value === "string";

const isMemoryFile = (value: unknown): value is LibraryMemoryFile =>
  isRecord(value) &&
  typeof value.file === "string" &&
  isNullableString(value.name) &&
  isNullableString(value.description) &&
  isNullableString(value.type) &&
  typeof value.updatedAt === "number";

export const isLibraryMemoryProject = (value: unknown): value is LibraryMemoryProject =>
  isRecord(value) &&
  typeof value.slug === "string" &&
  isNullableString(value.cwd) &&
  (value.index === null || (isRecord(value.index) && typeof value.index.lines === "number" && typeof value.index.bytes === "number")) &&
  Array.isArray(value.files) &&
  value.files.every(isMemoryFile);
