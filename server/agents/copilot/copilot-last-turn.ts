// The last completed exchange of a copilot session — what a handoff carries to another cell, what a
// round-table seat contributes, and what the finished-turn push quotes (capability matrix row 12).
//
// Read from `session-state/<id>/events.jsonl`, NOT from the `turns` table the conversation view
// uses. The table is written one turn LATE: measured against copilot 1.0.83, a turn's row appears
// when the NEXT prompt is submitted, so the newest finished answer is never in it. Reading it here
// would hand another cell the previous turn's answer as this one's — the error that cannot be seen
// at the other end.
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
import { EMPTY_TURN, type LastTurn } from "../../session/transcript/last-turn.js";

const FINAL_ANSWER = "final_answer";

const isSubagentRecord = (record: Record<string, unknown>): boolean => typeof record.agentId === "string";

const isUserPrompt = (record: Record<string, unknown>): boolean => record.type === "user.message";

const promptOf = (record: Record<string, unknown>): string | null => (isRecord(record.data) ? readString(record.data.content).trim() || null : null);

// Absent or an empty list is "no tools"; any other value — including a shape that is not a list —
// is not trusted as a turn's end, so a malformed record cannot be quoted as the answer.
const hasToolRequests = (data: Record<string, unknown>): boolean =>
  data.toolRequests !== undefined && !(Array.isArray(data.toolRequests) && data.toolRequests.length === 0);

/** The text of an answer that ends the turn, or null for every other record. */
export function copilotFinalAnswer(record: Record<string, unknown>): string | null {
  if (record.type !== "assistant.message" || !isRecord(record.data)) return null;
  if (record.data.phase !== FINAL_ANSWER || hasToolRequests(record.data)) return null;
  return readString(record.data.content).trim() || null;
}

const mainAgentRecords = (records: readonly Record<string, unknown>[]): Record<string, unknown>[] => records.filter((record) => !isSubagentRecord(record));

/** The last COMPLETE exchange. A turn still running, or one interrupted before it answered, falls
 *  back to the previous complete one, as claude's and cursor's readers do: a handoff should quote
 *  the answer the agent finished, not the question it is working on. */
export function copilotLastTurnFromEvents(records: readonly Record<string, unknown>[]): LastTurn {
  const folded = mainAgentRecords(records).reduce<ExchangeFold>(foldExchange, { prompt: null, complete: EMPTY_TURN });
  return folded.complete;
}

interface ExchangeFold {
  /** The newest prompt seen so far, answered or not. */
  prompt: string | null;
  complete: LastTurn;
}

function foldExchange(fold: ExchangeFold, record: Record<string, unknown>): ExchangeFold {
  if (isUserPrompt(record)) return { prompt: promptOf(record), complete: fold.complete };
  const reply = copilotFinalAnswer(record);
  return reply === null ? fold : { prompt: fold.prompt, complete: { prompt: fold.prompt, reply } };
}

/** The reply to the NEWEST prompt, or null when that prompt has none — never an older exchange.
 *  The push needs this rather than the fallback above (#1650): an interrupted turn would otherwise
 *  be announced with the previous turn's answer. */
export function copilotCurrentTurnReplyFromEvents(records: readonly Record<string, unknown>[]): string | null {
  return mainAgentRecords(records).reduce<string | null>((reply, record) => (isUserPrompt(record) ? null : (copilotFinalAnswer(record) ?? reply)), null);
}
