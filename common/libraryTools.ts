// What the Library's tools kind shows for one directory (#3332): the instruction files Claude Code
// loads there, in the order it loads them. Shared by the route and the view.
import { isRecord } from "./isRecord.js";

export const INSTRUCTION_SCOPES = ["managed", "user", "user-rule", "directory", "project", "local", "rule", "agents", "import"] as const;
export type LibraryInstructionScope = (typeof INSTRUCTION_SCOPES)[number];

/** Claude Code skips an instruction file larger than this and loads none of it. */
export const INSTRUCTION_FILE_MAX_BYTES = 4 * 1024 * 1024;

export interface LibraryInstructionFile {
  scope: LibraryInstructionScope;
  path: string;
  /** "launch": read at session start; "on-demand": only when Claude works with matching files. */
  loads: "launch" | "on-demand";
  /** The file whose `@path` import brought this one in, for an import. */
  importedBy: string | null;
  lines: number;
  bytes: number;
  /** "too-large": over the size Claude Code reads at all, so none of it loads. */
  state: "ok" | "too-large" | "unreadable";
}

export interface LibraryInstructions {
  cwd: string;
  files: LibraryInstructionFile[];
  /** No CLAUDE.md counts here, so Claude Code reads AGENTS.md instead (the default setting). */
  agentsMd: boolean;
}

const isScope = (value: unknown): value is LibraryInstructionScope => INSTRUCTION_SCOPES.some((scope) => scope === value);

const isInstructionFile = (value: unknown): value is LibraryInstructionFile =>
  isRecord(value) &&
  isScope(value.scope) &&
  typeof value.path === "string" &&
  (value.loads === "launch" || value.loads === "on-demand") &&
  (value.importedBy === null || typeof value.importedBy === "string") &&
  typeof value.lines === "number" &&
  typeof value.bytes === "number" &&
  (value.state === "ok" || value.state === "too-large" || value.state === "unreadable");

export const isLibraryInstructions = (value: unknown): value is LibraryInstructions =>
  isRecord(value) && typeof value.cwd === "string" && Array.isArray(value.files) && value.files.every(isInstructionFile) && typeof value.agentsMd === "boolean";
