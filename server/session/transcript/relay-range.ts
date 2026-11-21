// Which exchanges of another terminal's conversation a relay sends: everything after the last one
// this directory received, ending at the last one the agent has FINISHED (#3389).
//
// Agents share no turn id, and a tail read cannot see absolute turn numbers, so a relayed turn is
// remembered by a fingerprint of what it said. Anything that makes the fingerprint unfindable — a
// compaction, a rewind, a log rewritten — falls back to the latest exchange alone, said out loud,
// rather than a guessed range.

import { createHash } from "node:crypto";
import type { TranscriptTurn } from "../../../common/transcriptView.js";
import { ownWordsOf } from "./relayed-prompt.js";

export interface RelayTurn {
  prompt: string;
  /** The view cut this prompt to fit its byte cap, so only its start can be compared. */
  promptClipped: boolean;
  /** Every assistant text of the turn in order, commentary included. Tool rows are not relayed. */
  replies: string[];
  at: string | null;
}

export interface RelayLimits {
  promptMaxChars: number;
  /** Quoted text across every turn sent, framing excluded; a single turn larger than this is still
   *  sent, its reply clipped so prompt and reply together fit. */
  totalMaxChars: number;
}

export const DEFAULT_RELAY_LIMITS: RelayLimits = { promptMaxChars: 600, totalMaxChars: 20_000 };

export type RelaySelection =
  | { status: "no-turn" }
  | { status: "nothing-new" }
  | {
      status: "ok";
      turns: RelayTurn[];
      /** Turns after the marker that did not fit. */
      omitted: number;
      /** The read stopped before the marker or the start, so an unknown number came before these. */
      moreBefore: boolean;
      /** There was a marker and it is nowhere in the conversation. */
      markLost: boolean;
      /** The fingerprint to record once the paste succeeds. */
      mark: string;
    };

export function relayTurnOf(turn: TranscriptTurn): RelayTurn | null {
  const promptRow = turn.rows.find((row) => row.kind === "user");
  if (promptRow === undefined) return null;
  const replies = turn.rows.filter((row) => row.kind === "assistant" && row.text.trim() !== "").map((row) => row.text);
  return { prompt: promptRow.text, promptClipped: promptRow.clipped === true, replies, at: turn.at };
}

export const relayFingerprint = (turn: RelayTurn): string =>
  createHash("sha256")
    .update(JSON.stringify([turn.prompt.trim(), turn.at, turn.replies.at(-1)?.trim() ?? ""]))
    .digest("hex");

export const isRelayMark = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

/** How many of `turns` (oldest first) are finished: up to the newest whose prompt is the last
 *  completed exchange's. When none is, the newest turn is the one still running. */
export function completedCount(turns: readonly RelayTurn[], lastCompletedPrompt: string | null): number {
  if (lastCompletedPrompt === null || turns.length === 0) return 0;
  const wanted = lastCompletedPrompt.trim();
  const index = turns.findLastIndex((turn) => (turn.promptClipped ? wanted.startsWith(turn.prompt.trimStart()) : turn.prompt.trim() === wanted));
  return index === -1 ? turns.length - 1 : index + 1;
}

const codePoints = (text: string): number => [...text].length;

// The prompt as formatRelay emits it, so a turn that only carried a pasted handoff costs its reply.
export const relayTurnChars = (turn: RelayTurn, limits: RelayLimits): number =>
  Math.min(codePoints(ownWordsOf(turn.prompt)), limits.promptMaxChars) + turn.replies.reduce((n, reply) => n + codePoints(reply), 0);

/** The newest turns that fit the budget, oldest first — always at least the newest one. */
function newestThatFit(pending: readonly RelayTurn[], limits: RelayLimits): RelayTurn[] {
  const fitted = pending.reduceRight<{ turns: RelayTurn[]; chars: number; full: boolean }>(
    (acc, turn) => {
      if (acc.full) return acc;
      const chars = acc.chars + relayTurnChars(turn, limits);
      if (acc.turns.length > 0 && chars > limits.totalMaxChars) return { ...acc, full: true };
      return { turns: [turn, ...acc.turns], chars, full: false };
    },
    { turns: [], chars: 0, full: false },
  );
  return fitted.turns;
}

export interface RelayInput {
  /** Every turn read, oldest first. */
  turns: readonly RelayTurn[];
  completed: number;
  mark: string | null;
  /** The read went back to the conversation's first turn. */
  reachedStart: boolean;
  limits: RelayLimits;
}

export function selectRelay(input: RelayInput): RelaySelection {
  const complete = input.turns.slice(0, input.completed);
  const latest = complete.at(-1);
  if (latest === undefined) return { status: "no-turn" };
  const markIndex = input.mark === null ? -1 : complete.findLastIndex((turn) => relayFingerprint(turn) === input.mark);
  if (markIndex === complete.length - 1) return { status: "nothing-new" };
  const markLost = input.mark !== null && markIndex === -1 && input.reachedStart;
  if (markLost) return { status: "ok", turns: [latest], omitted: 0, moreBefore: false, markLost, mark: relayFingerprint(latest) };
  const pending = complete.slice(markIndex + 1);
  const turns = newestThatFit(pending, input.limits);
  return {
    status: "ok",
    turns,
    omitted: pending.length - turns.length,
    moreBefore: markIndex === -1 && !input.reachedStart,
    markLost: false,
    mark: relayFingerprint(latest),
  };
}
