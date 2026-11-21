// The retrospective in /usage (#3335): what the last weeks went on — money, tokens, conversations and
// the PRs they made — by week, by project, by agent and by model, computed from the Library's index
// rather than Claude Code's own stats cache, which can stop updating. Shared by the route and the view.
// Money and tokens count when they were spent (#3395); a conversation and its PRs, in the week it started.
import { isRecord } from "./isRecord.js";

/** How far back the retrospective reaches. */
export const RETROSPECTIVE_WEEKS = 12;

export interface RetrospectiveTotals {
  costUsd: number;
  conversations: number;
  prs: number;
}

export interface RetrospectiveTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface LibraryRetrospective {
  /** Each week's totals, oldest first, every week present (an empty one is all zeros). `start_ms` is the
   *  Monday the week starts on, at local midnight on the server. */
  weeks: (RetrospectiveTotals & { start_ms: number })[];
  /** By project directory, the most spent first; a conversation with no directory is under "". */
  projects: (RetrospectiveTotals & { cwd: string })[];
  /** By agent, the most spent first. */
  agents: (RetrospectiveTotals & { agent: string })[];
  /** By model, the most spent first; a cost recorded with no model is under "". */
  models: { model: string; costUsd: number; tokens: RetrospectiveTokens }[];
  total: RetrospectiveTotals & { tokens: RetrospectiveTokens };
}

const isTotals = (value: unknown): value is RetrospectiveTotals =>
  isRecord(value) && typeof value.costUsd === "number" && typeof value.conversations === "number" && typeof value.prs === "number";
const isTokens = (value: unknown): value is RetrospectiveTokens =>
  isRecord(value) && ["input", "output", "cacheRead", "cacheWrite"].every((key) => typeof value[key] === "number");
const isModel = (value: unknown): boolean => isRecord(value) && typeof value.model === "string" && typeof value.costUsd === "number" && isTokens(value.tokens);
const listOf = (value: unknown, key: string, kind: "string" | "number"): boolean =>
  Array.isArray(value) && value.every((entry) => isTotals(entry) && isRecord(entry) && typeof entry[key] === kind);

export const isLibraryRetrospective = (value: unknown): value is LibraryRetrospective =>
  isRecord(value) &&
  listOf(value.weeks, "start_ms", "number") &&
  listOf(value.projects, "cwd", "string") &&
  listOf(value.agents, "agent", "string") &&
  Array.isArray(value.models) &&
  value.models.every(isModel) &&
  isTotals(value.total) &&
  isRecord(value.total) &&
  isTokens(value.total.tokens);
