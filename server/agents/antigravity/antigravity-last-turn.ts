// The last completed exchange of an Antigravity session — what a handoff carries to another cell,
// what a round-table seat contributes, and what the finished-turn push quotes (capability matrix
// row 12).
//
// THE RECORD SHAPE, measured on live sessions against agy 1.3.5 (a preamble turn, a step-by-step
// turn with commentaries and a shell command, an interrupt). `brain/<id>/.system_generated/logs/
// transcript.jsonl`, one step per line, each written whole once the step is DONE:
//
//   USER_INPUT        content "<USER_REQUEST>\n…\n</USER_REQUEST>\n<ADDITIONAL_METADATA>…"
//   PLANNER_RESPONSE  content "I will read…" + tool_calls[...]   a preamble, mid-turn
//   PLANNER_RESPONSE  content null + tool_calls[...]             a call with nothing said
//   GENERIC / VIEW_FILE / …                                       a tool's output
//   PLANNER_RESPONSE  content "…", no tool_calls                  the answer that ends the turn
//   PLANNER_RESPONSE  content null, no tool_calls                 what an interrupt leaves
//
// So the answer is the last PLANNER_RESPONSE with no tool calls AND some text. The text condition is
// not cosmetic: an interrupt writes a response with no tool calls and no content, and without it an
// interrupted turn would read as one that ended with an empty answer. A preamble always carries its
// tool calls in the same record, which is what keeps it from being quoted as the conclusion (#1487).
import { readString } from "../../../common/readString.js";
import { EMPTY_TURN, type LastTurn } from "../../session/transcript/last-turn.js";
import { antigravityPromptText } from "./antigravity-sessions.js";

const isUserInput = (record: Record<string, unknown>): boolean => record.type === "USER_INPUT";

const promptOf = (record: Record<string, unknown>): string | null => antigravityPromptText(readString(record.content)).trim() || null;

// Absent or an empty list is "no tools"; any other value — including a shape that is not a list —
// is not trusted as a turn's end, so a malformed record cannot be quoted as the answer.
const hasToolCalls = (record: Record<string, unknown>): boolean =>
  record.tool_calls !== undefined && !(Array.isArray(record.tool_calls) && record.tool_calls.length === 0);

/** The text of a response that ends the turn, or null for every other step. */
export function antigravityFinalAnswer(record: Record<string, unknown>): string | null {
  if (record.type !== "PLANNER_RESPONSE" || record.status !== "DONE" || hasToolCalls(record)) return null;
  return readString(record.content).trim() || null;
}

interface ExchangeFold {
  /** The newest prompt seen so far, answered or not. */
  prompt: string | null;
  complete: LastTurn;
}

function foldExchange(fold: ExchangeFold, record: Record<string, unknown>): ExchangeFold {
  if (isUserInput(record)) return { prompt: promptOf(record), complete: fold.complete };
  const reply = antigravityFinalAnswer(record);
  return reply === null ? fold : { prompt: fold.prompt, complete: { prompt: fold.prompt, reply } };
}

/** The last COMPLETE exchange. A turn still running, or one interrupted before it answered, falls
 *  back to the previous complete one, as the other agents' readers do. */
export function antigravityLastTurnFromSteps(records: readonly Record<string, unknown>[]): LastTurn {
  return records.reduce<ExchangeFold>(foldExchange, { prompt: null, complete: EMPTY_TURN }).complete;
}

/** The reply to the NEWEST prompt, or null when that prompt has none — never an older exchange, so
 *  an interrupted turn is not announced with the previous turn's answer (#1650). */
export function antigravityCurrentTurnReplyFromSteps(records: readonly Record<string, unknown>[]): string | null {
  return records.reduce<string | null>((reply, record) => (isUserInput(record) ? null : (antigravityFinalAnswer(record) ?? reply)), null);
}
