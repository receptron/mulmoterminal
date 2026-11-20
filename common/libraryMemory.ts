// Claude Code's auto memory as the Library reads it (#3331): each project's `memory/` folder, its
// `MEMORY.md` index, and the memory files with their frontmatter. Pure.
import { isRecord } from "./isRecord.js";

/** How much of `MEMORY.md` Claude Code loads, as its own source has it (2.1.292: 200 lines, 25,000
 *  bytes). Past either, the rest of the index is not in the agent's context. */
export const MEMORY_INDEX_LINES_MAX = 200;
export const MEMORY_INDEX_BYTES_MAX = 25_000;
/** The most a memory edit may write: far past any real memory, and what the editor refuses to send. */
export const MEMORY_EDIT_MAX_BYTES = 256 * 1024;

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
/** The text as the frontmatter rules read it: no byte-order mark (some Windows editors write one, and
 *  it would hide the opening `---`), and `\n` line ends. */
const normalizedMemory = (text: string): string => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

/** Where the closing delimiter starts, or -1: a line of exactly `---` (a `---draft` line inside is not
 *  one), at the end of the text or followed by a newline. -1 too when there is no opening line. */
function frontmatterEnd(normalized: string): number {
  const close = normalized.startsWith("---\n") ? /\n---(?:\n|$)/.exec(normalized.slice(3)) : null;
  return close === null ? -1 : close.index + 3;
}

/** Whether a frontmatter opens and has not closed yet — what a reader of a file's head asks to know
 *  whether to read on. */
export function frontmatterStillOpen(text: string): boolean {
  const normalized = normalizedMemory(text);
  return normalized.startsWith("---\n") && frontmatterEnd(normalized) === -1;
}

export function parseMemoryFrontmatter(text: string): MemoryFrontmatter {
  const normalized = normalizedMemory(text);
  const end = frontmatterEnd(normalized);
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

/** A memory's type: `metadata.type`, or a top-level `type` as some memory files write it — an empty one
 *  falls through. The list and the health check both decide it here. */
export const memoryType = (frontmatter: Pick<MemoryFrontmatter, "fields" | "metadata">): string | null =>
  frontmatter.metadata.type?.trim() || frontmatter.fields.type?.trim() || null;

/** What can be tidied in one memory file (#3331). */
export type MemoryFileIssue =
  | { kind: "not-in-index" }
  | { kind: "no-frontmatter"; missing: string[] }
  | { kind: "broken-link"; names: string[] }
  | { kind: "missing-path"; paths: string[] };

/** What can be tidied in a project's memory as a whole: its index. */
export type MemoryProjectIssue = { kind: "index-over-limit" } | { kind: "no-index" } | { kind: "dead-index-entry"; files: string[] };

export interface LibraryMemoryHealth {
  slug: string;
  issues: MemoryProjectIssue[];
  /** By file name; a file with nothing to tidy is not listed. */
  files: Record<string, MemoryFileIssue[]>;
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

const isFileIssue = (value: unknown): value is MemoryFileIssue => {
  if (!isRecord(value)) return false;
  if (value.kind === "not-in-index") return true;
  if (value.kind === "no-frontmatter") return isStringList(value.missing);
  if (value.kind === "broken-link") return isStringList(value.names);
  return value.kind === "missing-path" && isStringList(value.paths);
};

const isProjectIssue = (value: unknown): value is MemoryProjectIssue =>
  isRecord(value) && (value.kind === "index-over-limit" || value.kind === "no-index" || (value.kind === "dead-index-entry" && isStringList(value.files)));

export const isLibraryMemoryHealth = (value: unknown): value is LibraryMemoryHealth =>
  isRecord(value) &&
  typeof value.slug === "string" &&
  Array.isArray(value.issues) &&
  value.issues.every(isProjectIssue) &&
  isRecord(value.files) &&
  Object.values(value.files).every((issues) => Array.isArray(issues) && issues.every(isFileIssue));
