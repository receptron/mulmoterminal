// The last completed exchange of a copilot session — what a handoff carries to another cell, what a
// round-table seat contributes, and what the finished-turn push quotes (capability matrix row 12).
//
// Read from `session-state/<id>/events.jsonl`, NOT from the `turns` table the conversation view
// uses. On copilot 1.0.83 the table was written one turn LATE — a turn's row appeared when the NEXT
// prompt was submitted — and reading it would hand another cell the previous turn's answer as this
// one's. 1.0.114 writes the row with the answer, but an older CLI can still be installed.
//
// THE RECORD SHAPE, measured on live sessions (tools, a shell command, a subagent, an interrupt).
// One JSON object per line, `{type, data, id, timestamp, parentId}`:
//
//   user.message       data.content is what the user typed (`transformedContent` adds a datetime block)
//   assistant.message  data.phase "commentary" + toolRequests[...]   a preamble, mid-turn
//   assistant.message  data.phase "final_answer", toolRequests []    the answer that ends the turn
//   abort              data.reason "user_initiated"                  an interrupt; no final_answer follows
//
// Copilot labels the answer itself, so unlike claude (#1487) and cursor there is no inferring which
// prose concludes the turn. A record without that label is not an answer, and a future copilot that
// drops the field makes this go quiet rather than quote a preamble.
//
// A SUBAGENT writes into the same file: its prompt is a `user.message` and its result a
// `final_answer`, indistinguishable by type. Every record it writes carries a top-level `agentId`
// and the main agent's never do, so those are skipped — otherwise the subagent's instructions would
// be quoted as what the user asked.
import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import type { LastTurn } from "../../session/transcript/last-turn.js";
import { type ExchangeReader, hasToolList, lastCompleteExchange, newestPromptReply } from "../../session/transcript/exchange-fold.js";

const FINAL_ANSWER = "final_answer";

const isSubagentRecord = (record: Record<string, unknown>): boolean => typeof record.agentId === "string";

const isUserPrompt = (record: Record<string, unknown>): boolean => record.type === "user.message";

const promptOf = (record: Record<string, unknown>): string | null => (isRecord(record.data) ? readString(record.data.content).trim() || null : null);

/** The text of an answer that ends the turn, or null for every other record. */
export function copilotFinalAnswer(record: Record<string, unknown>): string | null {
  if (record.type !== "assistant.message" || !isRecord(record.data)) return null;
  if (record.data.phase !== FINAL_ANSWER || hasToolList(record.data.toolRequests)) return null;
  return readString(record.data.content).trim() || null;
}

const mainAgentRecords = (records: readonly Record<string, unknown>[]): Record<string, unknown>[] => records.filter((record) => !isSubagentRecord(record));

const COPILOT_EXCHANGE: ExchangeReader = { isPrompt: isUserPrompt, promptOf, finalAnswer: copilotFinalAnswer };

/** The last COMPLETE exchange. A turn still running, or one interrupted before it answered, falls
 *  back to the previous complete one, as claude's and cursor's readers do: a handoff should quote
 *  the answer the agent finished, not the question it is working on. */
export function copilotLastTurnFromEvents(records: readonly Record<string, unknown>[]): LastTurn {
  return lastCompleteExchange(mainAgentRecords(records), COPILOT_EXCHANGE);
}

/** The reply to the NEWEST prompt, or null when that prompt has none — never an older exchange.
 *  The push needs this rather than the fallback above (#1650): an interrupted turn would otherwise
 *  be announced with the previous turn's answer. */
export function copilotCurrentTurnReplyFromEvents(records: readonly Record<string, unknown>[]): string | null {
  return newestPromptReply(mainAgentRecords(records), COPILOT_EXCHANGE);
}
