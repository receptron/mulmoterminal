// The Library's index over the wire (#3328). The shape is the same for every agent; only claude
// is indexed so far, which is why `agent` is a column rather than an assumption.
import { isRecord } from "./isRecord.js";
import { TERMINAL_AGENTS, type TerminalAgent } from "./sessionAgent.js";

export interface LibraryPrLink {
  number: number;
  url: string;
  repository: string;
}

export interface LibraryConversation {
  /** The session id, which is the transcript's file name. A subagent's is its own file name. */
  id: string;
  agent: TerminalAgent;
  /** `/rename`, else the agent's own title, else the first prompt. Null for a conversation with none. */
  title: string | null;
  cwd: string | null;
  gitBranch: string | null;
  prs: LibraryPrLink[];
  /** From the last cost record. Null — never 0 — when the agent wrote none. */
  costUsd: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  /** Epoch milliseconds. */
  startedAt: number | null;
  endedAt: number | null;
  skills: string[];
  hookErrors: number;
  userTurns: number;
  isSidechain: boolean;
  /** The conversation a subagent ran under. */
  parentId: string | null;
  /** Run from under the OS temp directory: kept for the storage view, left out of search. */
  isTemporary: boolean;
  /** How the agent was started, as it recorded it: `cli` for an interactive session, `claude-desktop`
   *  for the desktop app, `sdk-cli` for `claude -p` and the SDK. Null when it recorded none. */
  entrypoint: string | null;
}

/** The entrypoint of a run nobody typed into — `claude -p` and the SDK. On a working machine these
 *  are most of the transcripts (hooks and tools call claude), so lists leave them out by default. */
export const AUTOMATED_ENTRYPOINT = "sdk-cli";

export const LIBRARY_TURN_ROLES = ["user", "assistant", "prompt"] as const;
/** `prompt` is a line of the agent's own prompt history, which holds prompts its transcript lacks. */
export type LibraryTurnRole = (typeof LIBRARY_TURN_ROLES)[number];

export interface LibrarySearchHit {
  conversation: LibraryConversation;
  /** Null when only the title matched. */
  snippet: string | null;
  role: LibraryTurnRole | null;
}

export interface LibraryIndexStatus {
  indexing: boolean;
  filesDone: number;
  filesTotal: number;
  /** Epoch milliseconds of the last complete pass, by any process sharing this index. */
  finishedAt: number | null;
}

export interface LibraryConversationPage {
  conversations: LibraryConversation[];
  /** One was found past the page — a fact, not an inference from a full page. */
  hasMore: boolean;
}

// ---- reading the wire back --------------------------------------------------------------------

const nullableString = (value: unknown): boolean => value === null || typeof value === "string";
const nullableNumber = (value: unknown): boolean => value === null || typeof value === "number";

const isPrLink = (value: unknown): value is LibraryPrLink =>
  isRecord(value) && typeof value.number === "number" && typeof value.url === "string" && typeof value.repository === "string";

export function isLibraryConversation(value: unknown): value is LibraryConversation {
  if (!isRecord(value)) return false;
  const v = value;
  return (
    typeof v.id === "string" &&
    TERMINAL_AGENTS.some((agent) => agent === v.agent) &&
    ["title", "cwd", "gitBranch", "parentId", "entrypoint"].every((key) => nullableString(v[key])) &&
    ["costUsd", "linesAdded", "linesRemoved", "startedAt", "endedAt"].every((key) => nullableNumber(v[key])) &&
    Array.isArray(v.prs) &&
    v.prs.every(isPrLink) &&
    Array.isArray(v.skills) &&
    v.skills.every((skill) => typeof skill === "string") &&
    typeof v.hookErrors === "number" &&
    typeof v.userTurns === "number" &&
    typeof v.isSidechain === "boolean" &&
    typeof v.isTemporary === "boolean"
  );
}

export const isLibrarySearchHit = (value: unknown): value is LibrarySearchHit =>
  isRecord(value) &&
  isLibraryConversation(value.conversation) &&
  nullableString(value.snippet) &&
  (value.role === null || LIBRARY_TURN_ROLES.some((role) => role === value.role));

export const isLibraryIndexStatus = (value: unknown): value is LibraryIndexStatus =>
  isRecord(value) &&
  typeof value.indexing === "boolean" &&
  typeof value.filesDone === "number" &&
  typeof value.filesTotal === "number" &&
  nullableNumber(value.finishedAt);
