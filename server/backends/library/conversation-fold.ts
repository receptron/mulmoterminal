// One transcript record into a conversation's summary row and its searchable text (#3328).
//
// The state is resumable — it holds no records, only what the row needs — so the index can keep it
// beside the offset it stopped at and continue on what was appended. Every field is a fold over
// every record for the reason summary-scan.ts gives: a window drops what came early.
//
// Pure: no fs, no clock. What a record does not carry stays as it was, so an unknown `type`, a
// missing field or a wrong-typed one changes nothing rather than throwing.
import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import { finiteNumber } from "../../../common/finiteNumber.js";
import type { LibraryConversation, LibraryPrLink } from "../../../common/library.js";
import { conversationTurnsFromParsed, customTitleOfRecord } from "../../session/transcript/transcript.js";

/** A turn's text is searched from its start; past this it is long pasted material, not the ask. */
export const TURN_TEXT_CAP = 1000;
/** The first prompt stands in for a title, and a title is one line. */
export const FIRST_PROMPT_TITLE_CAP = 200;
/** PRs and skills a row keeps, newest last. The state is stored with every batch, so it may not grow
 *  with the transcript; a real conversation names far fewer of either. */
export const LIST_FIELD_CAP = 50;

/** Appends unless already there, dropping the oldest past the cap. */
function pushCapped<T>(list: T[], item: T, same: (a: T, b: T) => boolean): void {
  if (list.some((known) => same(known, item))) return;
  list.push(item);
  if (list.length > LIST_FIELD_CAP) list.splice(0, list.length - LIST_FIELD_CAP);
}

/** The summary fields as the row will carry them, plus the three a title is chosen from. */
export type ConversationState = Omit<LibraryConversation, "id" | "agent" | "title" | "parentId" | "isTemporary"> & {
  aiTitle: string | null;
  customTitle: string | null;
  firstPrompt: string | null;
};

export interface IndexedTurn {
  role: "user" | "assistant";
  text: string;
  at: number | null;
}

export const emptyConversationState = (): ConversationState => ({
  aiTitle: null,
  customTitle: null,
  firstPrompt: null,
  cwd: null,
  gitBranch: null,
  prs: [],
  costUsd: null,
  linesAdded: null,
  linesRemoved: null,
  startedAt: null,
  endedAt: null,
  skills: [],
  hookErrors: 0,
  userTurns: 0,
  isSidechain: false,
  entrypoint: null,
});

export const conversationTitle = (state: ConversationState): string | null => state.customTitle ?? state.aiTitle ?? state.firstPrompt;

const nonEmpty = (value: unknown): string | null => readString(value).trim() || null;

/** Epoch milliseconds from an ISO timestamp, or null for anything that is not one. */
export function recordTime(record: Record<string, unknown>): number | null {
  const parsed = Date.parse(readString(record.timestamp));
  return Number.isNaN(parsed) ? null : parsed;
}

/** Mutates `state` with what the record says, and answers the turn it adds to search, if any. */
export function foldConversationRecord(state: ConversationState, record: Record<string, unknown>): IndexedTurn | null {
  foldTime(state, record);
  foldPlace(state, record);
  foldTitles(state, record);
  foldPr(state, record);
  foldCost(state, record);
  foldActivity(state, record);
  return foldTurn(state, record);
}

function foldTime(state: ConversationState, record: Record<string, unknown>): void {
  const at = recordTime(record);
  if (at === null) return;
  state.startedAt = state.startedAt === null ? at : Math.min(state.startedAt, at);
  state.endedAt = state.endedAt === null ? at : Math.max(state.endedAt, at);
}

// The first cwd is where the conversation began; the newest branch is where it ended up.
function foldPlace(state: ConversationState, record: Record<string, unknown>): void {
  state.cwd ??= nonEmpty(record.cwd);
  state.entrypoint ??= nonEmpty(record.entrypoint);
  state.gitBranch = nonEmpty(record.gitBranch) ?? state.gitBranch;
  if (record.isSidechain === true) state.isSidechain = true;
}

function foldTitles(state: ConversationState, record: Record<string, unknown>): void {
  if (record.type === "ai-title") state.aiTitle = nonEmpty(record.aiTitle) ?? state.aiTitle;
  const renamed = customTitleOfRecord(record);
  if (renamed !== undefined) state.customTitle = renamed;
}

function foldPr(state: ConversationState, record: Record<string, unknown>): void {
  if (record.type !== "pr-link") return;
  const pr = prLinkOf(record);
  if (pr !== null) pushCapped(state.prs, pr, (a, b) => a.url === b.url);
}

export function prLinkOf(record: Record<string, unknown>): LibraryPrLink | null {
  const number = finiteNumber(record.prNumber);
  const url = nonEmpty(record.prUrl);
  if (number === null || url === null) return null;
  return { number, url, repository: readString(record.prRepository) };
}

// `cost-state` is a running total the agent rewrites, so the last one is the answer.
function foldCost(state: ConversationState, record: Record<string, unknown>): void {
  if (record.type !== "cost-state") return;
  state.costUsd = finiteNumber(record.totalCostUSD) ?? state.costUsd;
  state.linesAdded = finiteNumber(record.totalLinesAdded) ?? state.linesAdded;
  state.linesRemoved = finiteNumber(record.totalLinesRemoved) ?? state.linesRemoved;
}

function foldActivity(state: ConversationState, record: Record<string, unknown>): void {
  const skill = nonEmpty(record.attributionSkill);
  if (skill !== null) pushCapped(state.skills, skill, (a, b) => a === b);
  if (Array.isArray(record.hookErrors)) state.hookErrors += record.hookErrors.length;
}

function foldTurn(state: ConversationState, record: Record<string, unknown>): IndexedTurn | null {
  if (record.isMeta === true) return null;
  const turn = conversationTurnsFromParsed([record])[0];
  if (turn === undefined) return null;
  if (turn.role === "user") {
    state.userTurns += 1;
    state.firstPrompt ??= firstLine(turn.text).slice(0, FIRST_PROMPT_TITLE_CAP);
  }
  return { role: turn.role, text: turn.text.slice(0, TURN_TEXT_CAP), at: recordTime(record) };
}

const firstLine = (text: string): string =>
  text
    .split("\n")
    .find((line) => line.trim() !== "")
    ?.trim() ?? text;

const isPrLink = (value: unknown): value is LibraryPrLink =>
  isRecord(value) && prLinkOf({ prNumber: value.number, prUrl: value.url }) !== null && typeof value.repository === "string";

/** A state read back from the index. Untrusted: the file is on disk and an older build may have
 *  written it, so anything off-shape means "fold the transcript again". */
export function isConversationState(value: unknown): value is ConversationState {
  if (!isRecord(value)) return false;
  const nullableStrings = ["aiTitle", "customTitle", "firstPrompt", "cwd", "gitBranch", "entrypoint"];
  const nullableNumbers = ["costUsd", "linesAdded", "linesRemoved", "startedAt", "endedAt"];
  return (
    nullableStrings.every((key) => value[key] === null || typeof value[key] === "string") &&
    nullableNumbers.every((key) => value[key] === null || typeof value[key] === "number") &&
    Array.isArray(value.prs) &&
    value.prs.every(isPrLink) &&
    Array.isArray(value.skills) &&
    value.skills.every((skill) => typeof skill === "string") &&
    typeof value.hookErrors === "number" &&
    typeof value.userTurns === "number" &&
    typeof value.isSidechain === "boolean"
  );
}
