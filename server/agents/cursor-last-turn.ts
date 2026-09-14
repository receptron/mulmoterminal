// The last completed exchange of a cursor session — what the finished-turn push quotes, what a
// handoff carries to another cell, and what a round-table seat contributes (capability matrix
// row 12).
//
// THE RECORD SHAPE, measured against a real transcript (cursor-agent 2026.09.10-fd3934a). One JSON
// object per line, in `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`:
//
//   {"role":"user","message":{"content":[{"type":"text","text":"<timestamp>…</timestamp>\n<user_query>\n…\n</user_query>"}]}}
//   {"role":"assistant","message":{"content":[{"type":"text","text":"I'll read probe.txt…"},{"type":"tool_use","name":"Read",…}]}}
//   {"role":"assistant","message":{"content":[{"type":"tool_use","name":"Write",…}]}}
//   {"role":"assistant","message":{"content":[{"type":"text","text":"DONE"}]}}
//   {"type":"turn_ended","status":"success"}
//
// WHICH TEXT IS THE ANSWER is the whole difficulty, and claude's reader paid for the lesson: 78% of
// the assistant prose in a sample of real transcripts was mid-turn narration, and handing a round
// table "I'll read the actual files before weighing in." as a seat's contribution is what #1487
// was. Cursor gives a turn boundary outright — the `turn_ended` record — but no per-record "this
// ends the turn" flag, so the rule here is deliberately STRICTER than "the last prose before it":
//
//   the reply is the last assistant record before `turn_ended` **that carries no tool call**.
//
// An assistant record that mixes prose with a `tool_use` is a preamble by construction — the turn
// continued, or the tool would not be there — so it is passed over. The cost of the strict rule is
// answering `null` for a turn that ended without prose; the cost of the loose one is quoting a
// preamble as the conclusion, which is the error that cannot be seen at the other end.
import { isRecord } from "../../common/isRecord.js";
import { EMPTY_TURN, type LastTurn } from "../session/last-turn.js";

const readString = (value: unknown): string => (typeof value === "string" ? value : "");

/** The `content` array of a transcript record, or an empty one for anything else. */
function contentOf(record: Record<string, unknown>): unknown[] {
  if (!isRecord(record.message)) return [];
  const content: unknown = record.message.content;
  return Array.isArray(content) ? content : [];
}

const hasToolCall = (parts: readonly unknown[]): boolean => parts.some((part) => isRecord(part) && part.type === "tool_use");

/** Every text part of one record, joined. Cursor splits a long answer across parts of one record,
 *  so taking only the first would truncate it mid-sentence. */
const textOf = (parts: readonly unknown[]): string =>
  parts
    .filter((part) => isRecord(part) && part.type === "text")
    .map((part) => (isRecord(part) ? readString(part.text) : ""))
    .join("")
    .trim();

const OPEN_TAG = "<user_query>";
const CLOSE_TAG = "</user_query>";

/** What the USER said, with the wrapper cursor puts around it removed — cursor prepends a
 *  `<timestamp>` block and wraps the prompt itself in `<user_query>`, and neither belongs in a quote
 *  of what was asked.
 *
 *  FIRST OPEN TO **LAST** CLOSE, and that is the whole of why this is index arithmetic rather than a
 *  regex. Cursor does NOT escape the marker: a prompt containing the literal text `</user_query>` is
 *  stored verbatim inside the wrapper (measured — asked in one, read back from the transcript). A
 *  non-greedy capture stops at the first close and truncates the prompt there, which is exactly the
 *  text a user is most likely to type while asking about this format. The last close is the wrapper's
 *  own, because cursor appends it after the prompt.
 *
 *  Unwrapped only when both markers are present and in that order; anything else is returned as it
 *  came, which is what a record from some other writer should get. */
export function cursorUserText(text: string): string {
  const open = text.indexOf(OPEN_TAG);
  const close = text.lastIndexOf(CLOSE_TAG);
  if (open === -1 || close <= open) return text.trim();
  return text.slice(open + OPEN_TAG.length, close).trim();
}

/**
 * The last COMPLETE exchange in these records — a turn cursor has closed with `turn_ended`.
 *
 * Pure, and given the records rather than a path, so the rule above is a spec rather than a habit.
 * A turn still running answers the previous complete one, as claude's reader does: a cell whose
 * agent is mid-answer should quote the answer it finished, not the question it is working on.
 */
export function cursorLastTurnFromRecords(records: readonly Record<string, unknown>[]): LastTurn {
  let prompt: string | null = null;
  let reply: string | null = null;
  let complete: LastTurn | null = null;

  for (const record of records) {
    if (record.type === "turn_ended") {
      // Only a turn with something in it counts. A `turn_ended` whose exchange began before the
      // window this was read from has neither half, and answering it would blank a good answer
      // from further up.
      if (prompt !== null || reply !== null) complete = { prompt, reply };
      reply = null;
      continue;
    }
    const parts = contentOf(record);
    if (record.role === "user") {
      // A new prompt starts a new exchange: whatever the previous one's reply was, it belongs to
      // the turn already closed above.
      prompt = cursorUserText(textOf(parts)) || null;
      reply = null;
      continue;
    }
    if (record.role !== "assistant" || hasToolCall(parts)) continue;
    reply = textOf(parts) || reply;
  }
  return complete ?? EMPTY_TURN;
}
