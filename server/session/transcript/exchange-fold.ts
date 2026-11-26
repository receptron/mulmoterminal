// The two readings every record-per-step agent log answers the same way once it says which records
// are prompts and which are answers: the last COMPLETE exchange, and the reply to the newest prompt.
import { EMPTY_TURN, type LastTurn } from "./last-turn.js";

type LogRecord = Record<string, unknown>;

export interface ExchangeReader {
  isPrompt: (record: LogRecord) => boolean;
  promptOf: (record: LogRecord) => string | null;
  /** The text of an answer that ends the turn, or null for every other record. */
  finalAnswer: (record: LogRecord) => string | null;
}

// Absent or an empty list is "no tools"; any other value — including a shape that is not a list —
// is not trusted as a turn's end, so a malformed record cannot be quoted as the answer.
export const hasToolList = (value: unknown): boolean => value !== undefined && !(Array.isArray(value) && value.length === 0);

interface ExchangeFold {
  /** The newest prompt seen so far, answered or not. */
  prompt: string | null;
  complete: LastTurn;
}

const foldExchange =
  (reader: ExchangeReader) =>
  (fold: ExchangeFold, record: LogRecord): ExchangeFold => {
    if (reader.isPrompt(record)) return { prompt: reader.promptOf(record), complete: fold.complete };
    const reply = reader.finalAnswer(record);
    return reply === null ? fold : { prompt: fold.prompt, complete: { prompt: fold.prompt, reply } };
  };

/** The last COMPLETE exchange. A turn still running, or one interrupted before it answered, falls
 *  back to the previous complete one: a handoff should quote the answer the agent finished. */
export function lastCompleteExchange(records: readonly LogRecord[], reader: ExchangeReader): LastTurn {
  return records.reduce<ExchangeFold>(foldExchange(reader), { prompt: null, complete: EMPTY_TURN }).complete;
}

/** The reply to the NEWEST prompt, or null when that prompt has none — never an older exchange, so
 *  an interrupted turn is not announced with the previous turn's answer. */
export function newestPromptReply(records: readonly LogRecord[], reader: ExchangeReader): string | null {
  return records.reduce<string | null>((reply, record) => (reader.isPrompt(record) ? null : (reader.finalAnswer(record) ?? reply)), null);
}
