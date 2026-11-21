// The last completed exchange of a grok conversation — what a handoff carries to another cell and
// what a round-table seat contributes (capability matrix row 12).
//
// THE RECORD SHAPE, measured on live conversations against grok 1.0.34 (a preamble turn, a
// step-by-step turn with commentaries and a shell command, a prompt holding the literal
// `</user_query>`, a cancelled turn), and checked against a 0.2-era conversation of the same shape.
// `chat_history.jsonl`, one message per line, each appended once that step completes:
//
//   user         content [{type:"text", text:"<user_query>\n…\n</user_query>"}], prompt_index N
//   user         … synthetic_reason "system_reminder"            context grok injects, not the user
//   reasoning    content null
//   assistant    content "I'll read…" + tool_calls[...]           a preamble, mid-turn
//   tool_result  content "1→apple\n"
//   assistant    content "…", no tool_calls                      the answer that ends the turn
//
// The user's prompts are the `user` messages carrying a `prompt_index`; the others are context grok
// adds (the workspace header, skill lists, MCP servers), and quoting one as what was asked would be
// wrong. A cancelled turn writes nothing after its last completed step — the half-streamed answer is
// discarded — so it simply has no answer, and the reader falls back to the turn before.
import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import { EMPTY_TURN, type LastTurn } from "../../session/transcript/last-turn.js";
import { userQueryText } from "../user-query.js";

const isUserPrompt = (record: Record<string, unknown>): boolean => record.type === "user" && typeof record.prompt_index === "number";

/** Every text part of a user message, joined, or the content itself when it is a plain string. */
const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter(isRecord)
        .filter((part) => part.type === "text")
        .map((part) => readString(part.text))
        .join("")
    : readString(content);

const promptOf = (record: Record<string, unknown>): string | null => userQueryText(textOf(record.content)) || null;

// Absent or an empty list is "no tools"; any other value — including a shape that is not a list —
// is not trusted as a turn's end, so a malformed record cannot be quoted as the answer.
const hasToolCalls = (record: Record<string, unknown>): boolean =>
  record.tool_calls !== undefined && !(Array.isArray(record.tool_calls) && record.tool_calls.length === 0);

/** The text of an answer that ends the turn, or null for every other message. */
export function grokFinalAnswer(record: Record<string, unknown>): string | null {
  if (record.type !== "assistant" || hasToolCalls(record)) return null;
  return readString(record.content).trim() || null;
}

interface ExchangeFold {
  /** The newest prompt seen so far, answered or not. */
  prompt: string | null;
  complete: LastTurn;
}

function foldExchange(fold: ExchangeFold, record: Record<string, unknown>): ExchangeFold {
  if (isUserPrompt(record)) return { prompt: promptOf(record), complete: fold.complete };
  const reply = grokFinalAnswer(record);
  return reply === null ? fold : { prompt: fold.prompt, complete: { prompt: fold.prompt, reply } };
}

/** The last COMPLETE exchange. A turn still running, or one cancelled before it answered, falls back
 *  to the previous complete one, as the other agents' readers do. */
export function grokLastTurnFromMessages(records: readonly Record<string, unknown>[]): LastTurn {
  return records.reduce<ExchangeFold>(foldExchange, { prompt: null, complete: EMPTY_TURN }).complete;
}
