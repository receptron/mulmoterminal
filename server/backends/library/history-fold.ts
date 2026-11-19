// One line of `~/.claude/history.jsonl` as searchable text (#3328). That log holds every prompt as
// typed, including the ones sent while a turn was running, which never reach the transcript as a user
// record (see prompt-history.ts). Pure.
import { readString } from "../../../common/readString.js";
import { finiteNumber } from "../../../common/finiteNumber.js";
import { TURN_TEXT_CAP } from "./conversation-fold.js";

export interface HistoryPrompt {
  sessionId: string;
  text: string;
  at: number | null;
}

/** Null for a line with no text, or none naming its session: search answers conversations, and a
 *  prompt that belongs to none has nowhere to point. */
export function historyPromptOf(record: Record<string, unknown>): HistoryPrompt | null {
  const sessionId = readString(record.sessionId).trim();
  const text = readString(record.display).trim();
  if (sessionId === "" || text === "") return null;
  return { sessionId, text: text.slice(0, TURN_TEXT_CAP), at: finiteNumber(record.timestamp) };
}
