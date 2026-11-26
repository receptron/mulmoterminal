// A codex rollout, folded into the same turns the phone already reads for claude (#1822).
//
// The SHAPE of the view is claude's and is not re-decided here: turns opened by a user prompt,
// rows of `user` / `assistant` / `tool` / `unknown`, the line budget, the byte cap, the eviction
// rule. All of that lives in transcript-view.ts and is shared. What is codex's own — and what had
// to be measured rather than assumed — is which record means what.
//
// MEASURED over 500 randomly sampled rollouts of the 6,905 on this machine — `response_item`
// payload types, with the number of those 500 files each appears in:
//
//   function_call            7,900   286 files   a tool call: `name` + `arguments`
//   function_call_output     7,900   286 files   its result
//   reasoning                6,172   489 files   `summary: []`, body encrypted — nothing readable
//   message                  5,205   500 files   role: assistant / user / developer
//   custom_tool_call         2,898   260 files   a tool call: `name` + `input`
//   custom_tool_call_output  2,898   260 files   its result
//   web_search_call             15    10 files   `action: { type, url | query }`
//   tool_search_call / _output   3     3 files   a tool-catalogue search
//
// FOUR TRAPS, each of which produces a plausible-looking wrong view. The first two were found by
// sampling one rollout; the last two only by counting the store, and the fourth was invisible until
// the third was fixed:
//
//   1. A `role: "user"` message is usually NOT the person — it is codex's own preamble
//      (`<recommended_plugins>`, `<environment_context>`). The boundary rule is `codexUserTurn`
//      (codex-user-turn.ts), measured over all 6,334 rollouts and already serving three readers.
//      A fresh "has a user message" predicate fuses every exchange into one turn the budget can
//      never evict.
//   2. ONE prompt can be written TWICE — a `response_item` immediately followed by an `event_msg`
//      with identical text (924 such pairs in the store). `isDoubleWrite` drops the second.
//   3. THERE ARE TWO TOOL FAMILIES, not one. `custom_tool_call` carries `exec` and `apply_patch`
//      and appears in **52% of rollouts** — more than half the store. A renderer that knows only
//      `function_call` shows the prompt and the prose and silently omits the commands, which is a
//      conversation with its work cut out of it (Codex review, round 1).
//   4. AND THE OUTPUT FIELD IS TWO SHAPES, in BOTH families. Over 800 rollouts:
//      `function_call_output` is a string 12,580 times and an ARRAY 88 times;
//      `custom_tool_call_output` is an array 4,486 times and a string 269 times. A reader that
//      handles one shape per family drops the other — the original `function_call` handler was
//      already dropping those 88 before this file grew a second family to get wrong.
//
// SO THE RULE IS BY SHAPE, NOT BY NAME. Every payload type ending `_call` or `_output` is a tool
// record by construction, and an unrecognised one renders a row saying so rather than nothing. That
// is claude's `unknown` block rule applied to the record axis, and it is scoped to those two
// suffixes for the reason the earlier version of this comment gave for having no fallback at all:
// codex adds NON-tool record types routinely (`world_state`, `turn_context`, `session_meta`), and a
// row per unknown type would fill the view with names of things that are not conversation. Nothing
// in the store hits the fallback today — it is a tripwire, not a source of rows.
import { isRecord } from "../../../common/isRecord.js";
import { codexUserTurn, isDoubleWrite, type CodexUserTurn } from "../../agents/codex/codex-user-turn.js";
import { type TranscriptScan, foldTurnRecord, toolCallRow, toolResultRow } from "./transcript-view.js";
import type { TranscriptRow } from "../../../common/transcriptView.js";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The text of a content array — `[{ type: "input_text", text }, …]`, the shape both message
 *  contents and the array form of a tool output use. */
const partsText = (parts: readonly unknown[]): string =>
  parts
    .flatMap((part) => (isRecord(part) ? [text(part.text)] : []))
    .join("")
    .trim();

/** The readable parts of a message's content. Codex writes `input_text` on the way in and
 *  `output_text` on the way out; both carry `.text`, and a part with none is not prose. */
function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  return Array.isArray(content) ? partsText(content) : "";
}

/** A tool result's text, in EITHER shape it is written in — trap 4. Both families produce both, so
 *  this is asked of both rather than per family. */
function outputText(output: unknown): string {
  if (typeof output === "string") return output.trim();
  return Array.isArray(output) ? partsText(output) : "";
}

/** A tool call: the name, then the head of whatever it was called with. `arguments` is the
 *  `function_call` spelling and `input` the `custom_tool_call` one; they play the same part. */
function callRow(payload: Record<string, unknown>): TranscriptRow {
  return toolCallRow(text(payload.name), (text(payload.arguments) || text(payload.input)).trim());
}

/** What a web search did. The `action` is the readable half — an opened page's URL, or a query —
 *  and there is no `name` or `input` on these at all. */
function webSearchRow(payload: Record<string, unknown>): TranscriptRow {
  const action = isRecord(payload.action) ? payload.action : null;
  const what = action ? (text(action.url) || text(action.query)).trim() : "";
  const kind = action ? text(action.type).trim() : "";
  return { kind: "tool", text: ["web_search", kind, what].filter((part) => part !== "").join(" "), call: true };
}

const isCall = (type: string): boolean => type.endsWith("_call");
const isOutput = (type: string): boolean => type.endsWith("_output");

/** One rollout record, rendered. Empty when the record carries nothing a reader wants — which is
 *  most of them: accounting, the item stream, reasoning, and codex's own preamble. */
export function renderCodexRecord(record: Record<string, unknown>): TranscriptRow[] {
  const payload = isRecord(record.payload) ? record.payload : null;
  if (!payload || record.type !== "response_item") return [];
  const type = text(payload.type);
  if (type === "message") {
    // The developer role is the system preamble codex writes for itself, and a `user` message here
    // is either the person's prompt — already rendered by the boundary — or codex's own wrapper.
    if (payload.role !== "assistant") return [];
    const body = messageText(payload.content);
    return body === "" ? [] : [{ kind: "assistant", text: body }];
  }
  if (type === "web_search_call") return [webSearchRow(payload)];
  if (isOutput(type)) {
    const out = outputText(payload.output);
    // `toolResultRow`, not a row of our own: it applies claude's TOOL_RESULT_MAX_LINES and sets
    // `clipped`. A tool result should not be shown at six lines for one agent and whole for another.
    if (out !== "") return [toolResultRow(out)];
    // An output-shaped record whose `output` field is neither shape — `tool_search_output` carries
    // `tools`, not `output`. Named rather than dropped, for the reason in the header.
    return [{ kind: "tool", text: type }];
  }
  if (isCall(type)) return [callRow(payload)];
  // reasoning, and every non-tool record codex writes. Rendered as nothing on purpose: a row per
  // unknown type here would name things that are not conversation.
  return [];
}

/** The fold for one scan. A closure rather than a plain function, because trap 2 needs the record
 *  before this one: `isDoubleWrite` is what stops a prompt written in both shapes opening two
 *  turns. */
export function createCodexFold(scan: TranscriptScan): (record: Record<string, unknown>) => void {
  let previousTurn: CodexUserTurn | null = null;
  return (record) => {
    const turn = codexUserTurn(record);
    const duplicate = turn !== null && isDoubleWrite(turn, previousTurn);
    // Tracked for EVERY record's answer, including null: `previous` means "the turn from the record
    // immediately before this one", so a non-turn record between two identical prompts is what
    // tells them apart from a double write.
    previousTurn = turn;
    if (duplicate) return;
    foldTurnRecord(scan, {
      prompt: turn?.text ?? null,
      at: typeof record.timestamp === "string" ? record.timestamp : null,
      rows: renderCodexRecord(record),
    });
  };
}
