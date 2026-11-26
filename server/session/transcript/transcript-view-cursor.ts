// A cursor chat, folded into the same turns the phone already reads for claude and codex (#1822).
//
// The SHAPE of the view is claude's and is not re-decided here — turns, row kinds, the line budget,
// the byte cap, the eviction rule all live in transcript-view.ts. What is cursor's own is which
// record means what, and that was measured rather than assumed.
//
// MEASURED over EVERY cursor transcript on this machine — all 35 of
// `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`. The whole store, not a sample:
//
//   record kinds          role: assistant  57 (34 files) · role: user  40 (35 files)
//                         type: turn_ended 34 (34 files)
//   content parts         assistant/text  48 · user/text  40 · assistant/tool_use  19
//
// Three things follow, and the third is a limitation to state rather than a rule to write:
//
//   1. THE PROMPT IS WRAPPED. A user record's text arrives as
//      `<timestamp>…</timestamp>\n<user_query>…</user_query>`, and cursor does NOT escape the
//      marker — a prompt containing the literal text `</user_query>` is stored verbatim inside the
//      wrapper (measured in #2072). `userQueryText` unwraps first-open-to-LAST-close for that
//      reason, and it is shared with the conversation list's titles rather than copied.
//   2. `tool_use.input` IS AN OBJECT, not a string. Codex's two families both carry their arguments
//      as a string; cursor's is `{ command, description }`. So the call row serialises it rather
//      than printing it, and the same CALL_ARGS cap applies to the result.
//   3. THERE ARE NO TOOL RESULTS IN THE TRANSCRIPT AT ALL. Not a part type that renders nothing —
//      absent. Zero `tool_result` parts and zero result records across the whole store. So a cursor
//      turn shows what was asked, what was said, and WHICH tools ran, but never what they answered.
//      That is cursor's file, not a gap in this reader, and it is the one way a cursor turn reads
//      thinner than a claude or codex one.
//
// AND THE STORE IS SMALL — 35 transcripts, most of them this project's own probes, against codex's
// 6,905. The confidence that "these are the only part types" is correspondingly weaker, which is
// why an unrecognised content block renders an `unknown` ROW rather than nothing — ON BOTH SIDES OF
// THE CONVERSATION. The first version of this file filtered by role before reaching that fallback,
// so it held on the assistant side only, and a user record carrying an attachment beside its prompt
// folded to the prompt alone (Codex review, round 1, P3). A guarantee that covers one of two roles
// is not the guarantee the small store is relying on. That is claude's
// own rule on the same axis (a content block, not a record type), and here it is load-bearing
// rather than ceremonial: it is what makes a shape this store never showed us VISIBLE instead of
// silently thinning the view.
import { isRecord } from "../../../common/isRecord.js";
import { contentOf } from "../../agents/cursor/cursor-last-turn.js";
import { userQueryText } from "../../agents/user-query.js";
import { type TranscriptScan, foldTurnRecord, toolCallRow, unknownRow } from "./transcript-view.js";
import type { TranscriptRow } from "../../../common/transcriptView.js";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The input of a tool call, as text. A value that will not serialise — a cycle, a BigInt — answers
 *  the empty string rather than throwing: this runs inside a read the phone polls every five
 *  seconds per open session, and one odd record must not cost the whole view. */
function serialised(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** A tool call: the name, then the head of its input. The input is an OBJECT (trap 2), so it is
 *  serialised rather than printed. */
function toolUseRow(part: Record<string, unknown>): TranscriptRow {
  return toolCallRow(text(part.name), serialised(part.input));
}

/** One content block, rendered. An unrecognised one becomes claude's own `unknown` row rather than
 *  nothing — see the header on why that is load-bearing for this agent in particular, and
 *  `unknownRow` on why it names the type rather than carrying the block. */
function renderPart(part: unknown, speaker: "user" | "assistant"): TranscriptRow[] {
  if (!isRecord(part)) return [unknownRow(part)];
  if (part.type === "text") {
    const body = text(part.text).trim();
    return body === "" ? [] : [{ kind: speaker, text: body }];
  }
  if (part.type === "tool_use") return [toolUseRow(part)];
  return [unknownRow(part)];
}

/** Where a turn starts: a `role: "user"` record with text in it, unwrapped. */
export function cursorTurnPrompt(record: Record<string, unknown>): string | null {
  if (record.role !== "user") return null;
  const raw = contentOf(record)
    .flatMap((part) => (isRecord(part) && part.type === "text" ? [text(part.text)] : []))
    .join("");
  const prompt = userQueryText(raw);
  return prompt === "" ? null : prompt;
}

/** One transcript record, rendered.
 *
 *  A user record renders everything EXCEPT its text parts. The text is the turn's prompt, which the
 *  fold already lays down as the turn's first row, so rendering it here as well would print every
 *  prompt twice — but ANYTHING ELSE the person's record carries is content like any other, and
 *  dropping the whole record to avoid the duplicate throws that away with it.
 *
 *  That distinction is the whole of Codex's P3 on this PR, and it matters precisely BECAUSE this
 *  store is small: the argument for the unknown row is that a shape these 35 transcripts never held
 *  must arrive visible, and a role filter in front of it made that true on one side only. Measured:
 *  a user record carrying `{ type: "image" }` beside its prompt folded to the prompt alone, with no
 *  trace of the image.
 *
 *  A record that is neither role — `turn_ended`, and whatever cursor adds next — renders nothing;
 *  the fold drops `turn_ended` before reaching here, and a record with no `role` has no content
 *  array to read anyway. */
export function renderCursorRecord(record: Record<string, unknown>): TranscriptRow[] {
  if (record.role === "assistant") return contentOf(record).flatMap((part) => renderPart(part, "assistant"));
  if (record.role !== "user") return [];
  // The UNWRAPPED prompt first, then everything that is not a text part.
  //
  // Emitting the prompt here rather than leaving it to the fold is what keeps both halves: the fold
  // supplies the prompt row ONLY when a boundary record rendered nothing (transcript-view.ts), so a
  // record that rendered its image and left its text to the fold would have shown the image and
  // lost the question. And the prompt has to come from `cursorTurnPrompt`, not from the text part,
  // because the part still carries cursor's `<timestamp>` and `<user_query>` wrapper.
  const prompt = cursorTurnPrompt(record);
  const promptRows: TranscriptRow[] = prompt === null ? [] : [{ kind: "user", text: prompt }];
  const rest = contentOf(record)
    .filter((part) => !(isRecord(part) && part.type === "text"))
    .flatMap((part) => renderPart(part, "user"));
  return [...promptRows, ...rest];
}

/** The fold for one scan. Stateless across records — unlike codex, cursor writes each prompt once —
 *  but a factory all the same, so every source has one shape. */
export function createCursorFold(_scan: TranscriptScan): (record: Record<string, unknown>) => void {
  const scan = _scan;
  return (record) => {
    // `turn_ended` is a boundary cursor writes AFTER the fact, and it carries nothing to show. The
    // fold opens turns on prompts, so it needs no end marker — the next prompt is the end.
    if (record.type === "turn_ended") return;
    foldTurnRecord(scan, {
      prompt: cursorTurnPrompt(record),
      // Cursor's transcript records carry no timestamp of their own — the wrapper's `<timestamp>`
      // is prose inside the prompt, not a field. A turn with no clock keeps its content: `at` is
      // null and the phone shows the turn without a time, which is what that null is for.
      at: null,
      rows: renderCursorRecord(record),
    });
  };
}
