// The Library's index over the wire (#3328). The shape is the same for every agent; only claude
// is indexed so far, which is why `agent` is a column rather than an assumption.
import type { TerminalAgent } from "./sessionAgent.js";

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
}

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
