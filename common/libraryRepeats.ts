// Instructions typed again and again (#3334), for the Library's Repeats view: candidates for a
// CLAUDE.md rule or a skill. The server finds them; the browser shows them; a candidate is promoted by
// its id, so nothing the browser sends becomes words the agent reads.
import { isRecord } from "./isRecord.js";
import { PROMOTE_SKILL } from "./libraryPromote.js";

/** How far back, how many times and in how many conversations an instruction has to be typed to count
 *  as repeated. The server decides by them and the view says them. */
export const REPEAT_WINDOW_DAYS = 90;
export const REPEAT_MIN_COUNT = 3;
export const REPEAT_MIN_SESSIONS = 2;

/** What a repeated instruction can become. */
export const REPEAT_TARGETS = ["rule", "skill"] as const;

export type RepeatTarget = (typeof REPEAT_TARGETS)[number];

export const isRepeatTarget = (value: unknown): value is RepeatTarget => REPEAT_TARGETS.some((target) => target === value);

/** One time the instruction was typed. */
export interface RepeatOccurrence {
  sessionId: string;
  project: string | null;
  at: number;
  text: string;
}

export interface RepeatCandidate {
  /** Stable while the instruction's most typed form stays the most typed: hex. */
  id: string;
  /** Its most typed form. */
  text: string;
  /** The forms it was typed in, most typed first. */
  variants: string[];
  count: number;
  sessions: number;
  /** The directories it was typed in, most first. */
  projects: string[];
  lastAt: number;
}

/** One candidate with the times it was typed, newest first (for the skill that promotes it). */
export interface RepeatDetail extends RepeatCandidate {
  occurrences: RepeatOccurrence[];
}

const REPEAT_ID = /^[0-9a-f]{16}$/;

export const isRepeatId = (value: string): boolean => REPEAT_ID.test(value);

/** The first turn of the session that promotes a candidate, or null for an id that is not one. */
export function repeatTurn(target: RepeatTarget, id: string): string | null {
  return isRepeatId(id) ? `/${PROMOTE_SKILL} repeat ${target} ${id}` : null;
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

export const isRepeatCandidate = (value: unknown): value is RepeatCandidate =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.text === "string" &&
  isStrings(value.variants) &&
  typeof value.count === "number" &&
  typeof value.sessions === "number" &&
  isStrings(value.projects) &&
  typeof value.lastAt === "number";

const isOccurrence = (value: unknown): value is RepeatOccurrence =>
  isRecord(value) &&
  typeof value.sessionId === "string" &&
  (value.project === null || typeof value.project === "string") &&
  typeof value.at === "number" &&
  typeof value.text === "string";

export const isRepeatDetail = (value: unknown): value is RepeatDetail =>
  isRepeatCandidate(value) && isRecord(value) && Array.isArray(value.occurrences) && value.occurrences.every(isOccurrence);
