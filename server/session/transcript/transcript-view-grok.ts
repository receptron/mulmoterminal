// A grok conversation, folded into the same turns the phone and the Conversation pane already read
// for claude, codex, cursor and copilot (#3379).
//
// THE RECORD SHAPE is the one the last-turn reader measured (grok-last-turn.ts, grok 1.0.34):
// `chat_history.jsonl`, one message per line, appended as each step completes.
//
//   system       the system prompt                                      not shown
//   user         content [{type:"text", text:"<user_query>…"}], prompt_index N    opens a turn
//   user         … synthetic_reason "system_reminder"                   context grok injects; not shown
//   reasoning    content null, an encrypted summary                     not shown (claude's thinking is not either)
//   assistant    content "…", tool_calls [{id, name, arguments}]        prose, then one call row per call
//   tool_result  content "1→apple\n", tool_call_id                      a tool row, capped like every agent's
//
// Unlike copilot, grok writes what each tool ANSWERED, so a turn shows both halves. A record type
// not in that list becomes an `unknown` row naming its type rather than vanishing: this store was
// measured on few conversations, and a shape it never held must arrive visible.
import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import { userQueryText } from "../../agents/user-query.js";
import { type TranscriptScan, foldTurnRecord, toolResultRow, unknownRow } from "./transcript-view.js";
import type { TranscriptRow } from "../../../common/transcriptView.js";

/** How much of a tool call's arguments is shown — the bound codex's and cursor's calls get. */
const CALL_ARGS_MAX_CHARS = 200;

/** Records that carry nothing a reader of the conversation wants. */
const SILENT_TYPES: ReadonlySet<string> = new Set(["system", "reasoning"]);

const isUserPrompt = (record: Record<string, unknown>): boolean => record.type === "user" && typeof record.prompt_index === "number";

/** The parts of a user message, whether stored as a list or as a plain string. */
const partsOf = (content: unknown): unknown[] => (Array.isArray(content) ? content : [{ type: "text", text: readString(content) }]);

const isTextPart = (part: unknown): boolean => isRecord(part) && part.type === "text";

/** Where a turn starts: a user message with a `prompt_index`, unwrapped. */
export function grokTurnPrompt(record: Record<string, unknown>): string | null {
  if (!isUserPrompt(record)) return null;
  const raw = partsOf(record.content)
    .filter(isTextPart)
    .map((part) => (isRecord(part) ? readString(part.text) : ""))
    .join("");
  return userQueryText(raw) || null;
}

const clipHead = (value: string): string => (value.length > CALL_ARGS_MAX_CHARS ? `${value.slice(0, CALL_ARGS_MAX_CHARS)}…` : value);

/** A tool call: the name, then the head of its arguments (a JSON string as grok writes it). */
function callRow(call: unknown): TranscriptRow {
  if (!isRecord(call)) return unknownRow(call);
  const name = readString(call.name).trim() || "(unnamed tool)";
  const head = clipHead(readString(call.arguments).trim());
  return { kind: "tool", text: head === "" ? name : `${name} ${head}`, call: true };
}

function assistantRows(record: Record<string, unknown>): TranscriptRow[] {
  const prose = readString(record.content).trim();
  const proseRows: TranscriptRow[] = prose === "" ? [] : [{ kind: "assistant", text: prose }];
  const calls = record.tool_calls;
  if (calls === undefined) return proseRows;
  return [...proseRows, ...(Array.isArray(calls) ? calls.map(callRow) : [unknownRow(calls)])];
}

/** A user prompt's rows: the unwrapped prompt, then anything that is not a text part. */
function promptRows(record: Record<string, unknown>): TranscriptRow[] {
  const prompt = grokTurnPrompt(record);
  const head: TranscriptRow[] = prompt === null ? [] : [{ kind: "user", text: prompt }];
  return [
    ...head,
    ...partsOf(record.content)
      .filter((part) => !isTextPart(part))
      .map(unknownRow),
  ];
}

/** One chat_history message, rendered. */
export function renderGrokRecord(record: Record<string, unknown>): TranscriptRow[] {
  if (record.type === "user") return isUserPrompt(record) ? promptRows(record) : [];
  if (record.type === "assistant") return assistantRows(record);
  if (record.type === "tool_result") {
    const output = readString(record.content).trim();
    return output === "" ? [] : [toolResultRow(output)];
  }
  if (typeof record.type === "string" && SILENT_TYPES.has(record.type)) return [];
  return [unknownRow(record)];
}

/** The fold for one scan. Stateless: grok writes each prompt once. */
export function createGrokFold(scan: TranscriptScan): (record: Record<string, unknown>) => void {
  return (record) => {
    foldTurnRecord(scan, {
      prompt: grokTurnPrompt(record),
      // chat_history.jsonl carries no timestamp on any message, so a grok turn has no clock.
      at: null,
      rows: renderGrokRecord(record),
    });
  };
}
