// An Antigravity conversation, folded into the same turns the phone and the Conversation pane already
// read for the other agents (#3379).
//
// THE RECORD SHAPE is the one the last-turn reader measured (antigravity-last-turn.ts, agy 1.3.5):
// `brain/<id>/.system_generated/logs/transcript.jsonl`, one step per line, written whole when DONE.
//
//   USER_INPUT        content "<USER_REQUEST>…</USER_REQUEST><ADDITIONAL_METADATA>…"   opens a turn
//   PLANNER_RESPONSE  content (prose, or null) + tool_calls [{name, args}]          prose, then a call row per call
//   GENERIC / VIEW_FILE / CODE_ACTION / GREP_SEARCH / LIST_DIRECTORY / …            a tool's output (source MODEL)
//   CONVERSATION_HISTORY / CHECKPOINT (source SYSTEM)                               not shown
//
// Two things agy writes differently from every other agent here. A call's `args` values are each a
// JSON-encoded string (`"CommandLine": "\"echo hi\""`), so they are decoded one level before being
// shown. And every tool output opens with `Created At:` / `Completed At:` lines, which would spend
// the tool row's line cap on timestamps, so they are dropped.
//
// A tool output arrives under a type per tool (VIEW_FILE, GREP_SEARCH, …), so a MODEL step that is
// not a planner response and carries text is shown as a tool row whatever its type. Anything else
// becomes an `unknown` row naming its type rather than vanishing.
import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import { antigravityPromptText } from "../../agents/antigravity/antigravity-sessions.js";
import { type TranscriptScan, foldTurnRecord, proseThenCallRows, toolCallRow, toolResultRow, unknownRow } from "./transcript-view.js";
import type { TranscriptRow } from "../../../common/transcriptView.js";

const STAMP_LINE = /^(Created|Completed) At: .*\n/;

/** Where a turn starts: a USER_INPUT step, unwrapped. */
export function antigravityTurnPrompt(record: Record<string, unknown>): string | null {
  if (record.type !== "USER_INPUT") return null;
  return antigravityPromptText(readString(record.content)).trim() || null;
}

/** One argument value, decoded from the JSON string agy stores it as; left as it is otherwise. */
function decodedArg(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return value;
  }
}

/** The arguments of a call, as text. One that will not serialise answers the empty string rather
 *  than throwing: one odd record must not cost the whole view. */
function argsText(args: unknown): string {
  if (!isRecord(args)) return "";
  try {
    return JSON.stringify(Object.fromEntries(Object.entries(args).map(([key, value]) => [key, decodedArg(value)]))) ?? "";
  } catch {
    return "";
  }
}

const callRow = (call: unknown): TranscriptRow => (isRecord(call) ? toolCallRow(readString(call.name), argsText(call.args)) : unknownRow(call));

/** A tool's output, without the two timestamp lines agy opens every one with. */
function outputRows(content: string): TranscriptRow[] {
  const body = content.replace(STAMP_LINE, "").replace(STAMP_LINE, "").trim();
  return body === "" ? [] : [toolResultRow(body)];
}

/** One transcript step, rendered. */
export function renderAntigravityStep(record: Record<string, unknown>): TranscriptRow[] {
  if (record.type === "USER_INPUT") {
    const prompt = antigravityTurnPrompt(record);
    return prompt === null ? [] : [{ kind: "user", text: prompt }];
  }
  if (record.type === "PLANNER_RESPONSE") return proseThenCallRows(record.content, record.tool_calls, callRow);
  if (record.source === "SYSTEM") return [];
  if (record.source === "MODEL" && typeof record.content === "string") return outputRows(record.content);
  if (record.source === "MODEL" && record.content === undefined) return [];
  return [unknownRow(record)];
}

/** The fold for one scan. Stateless: agy writes each prompt once. */
export function createAntigravityFold(scan: TranscriptScan): (record: Record<string, unknown>) => void {
  return (record) => {
    foldTurnRecord(scan, {
      prompt: antigravityTurnPrompt(record),
      at: typeof record.created_at === "string" ? record.created_at : null,
      rows: renderAntigravityStep(record),
    });
  };
}
