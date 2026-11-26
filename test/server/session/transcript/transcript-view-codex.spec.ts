// @vitest-environment node
//
// Codex's half of the phone's conversation view (#1822), and the property that keeps claude's half
// from drifting away from it.
//
// The generator at the bottom is what survives a differential harness run: old-vs-new
// `foldTranscriptView` was compared over 400 real claude transcripts and 4,000 generated sequences
// (167,148 records, 0 mismatches) when the agent-neutral `foldTurnRecord` was extracted. That
// harness could not survive — half of it was the code it replaced — but the two things worth
// keeping did: WHICH record shapes matter, and WHAT must hold once the old code is gone.
import { describe, it, expect } from "vitest";
import { emptyTurnBoundary } from "../../../../server/session/transcript/turn-boundary";
import { createCodexFold, renderCodexRecord } from "../../../../server/session/transcript/transcript-view-codex";
import { seededRandom } from "../../../helpers/seededRandom";
import {
  emptyTranscriptScan,
  foldTranscriptView,
  foldTurnRecord,
  renderRecord,
  turnBoundaryPrompt,
  transcriptViewOf,
  TOOL_RESULT_MAX_LINES,
} from "../../../../server/session/transcript/transcript-view";

const rollout = (payload: Record<string, unknown>, timestamp = "2026-08-23T05:18:28.228Z") => ({
  timestamp,
  type: "response_item",
  payload,
});
const eventMsg = (payload: Record<string, unknown>) => ({ timestamp: "2026-08-23T05:18:29.000Z", type: "event_msg", payload });

const userMessage = (text: string) => rollout({ type: "message", role: "user", content: [{ type: "input_text", text }] });
const assistantMessage = (text: string) => rollout({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });

const foldAll = (records: Record<string, unknown>[]) => {
  const scan = emptyTranscriptScan();
  const fold = createCodexFold(scan);
  records.forEach(fold);
  return scan;
};

describe("renderCodexRecord", () => {
  it("renders an assistant message as prose", () => {
    expect(renderCodexRecord(assistantMessage("I'll inspect the PR."))).toEqual([{ kind: "assistant", text: "I'll inspect the PR." }]);
  });

  // TRAP 1, measured: a `role: "user"` message is usually codex's own preamble —
  // `<recommended_plugins>` and `<environment_context>` were both of them in the rollout sampled
  // whole. Rendering them would put codex's bookkeeping on the phone as if the person had typed it.
  it("renders nothing for a user or developer message — the boundary owns the prompt", () => {
    expect(renderCodexRecord(userMessage("<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>"))).toEqual([]);
    expect(renderCodexRecord(rollout({ type: "message", role: "developer", content: [{ type: "input_text", text: "<skills>" }] }))).toEqual([]);
  });

  it("names a tool call and shows the head of its arguments", () => {
    const row = renderCodexRecord(rollout({ type: "function_call", name: "exec_command", arguments: '{"cmd":"git diff"}' }));
    expect(row).toEqual([{ kind: "tool", text: 'exec_command {"cmd":"git diff"}', call: true }]);
  });

  // TRAP 3, measured over 500 rollouts: `custom_tool_call` carries `exec` and `apply_patch` and
  // appears in 260 of them — 52%. A renderer that knows only `function_call` shows the prompt and
  // the prose and silently omits more than half the store's commands (Codex review, round 1).
  it("renders a custom_tool_call, whose arguments live in `input`", () => {
    const row = renderCodexRecord(rollout({ type: "custom_tool_call", name: "exec", input: 'await tools.exec_command({cmd:"git status"})' }));
    expect(row).toEqual([{ kind: "tool", text: 'exec await tools.exec_command({cmd:"git status"})', call: true }]);
  });

  // TRAP 4: the output field is TWO shapes in BOTH families. Over 800 rollouts
  // `function_call_output` is a string 12,580 times and an array 88 times, and
  // `custom_tool_call_output` is an array 4,486 times and a string 269 times — so a reader that
  // handles one shape per family drops the other. The original function_call handler was already
  // dropping those 88 before this file had a second family to get wrong.
  it("reads a tool result written as an ARRAY of text parts", () => {
    const output = [
      { type: "input_text", text: "Script completed\n" },
      { type: "input_text", text: "?? node_modules" },
    ];
    expect(renderCodexRecord(rollout({ type: "custom_tool_call_output", output }))).toEqual([{ kind: "tool", text: "Script completed\n?? node_modules" }]);
    expect(renderCodexRecord(rollout({ type: "function_call_output", output }))).toEqual([{ kind: "tool", text: "Script completed\n?? node_modules" }]);
  });

  it("reads a tool result written as a plain string, in both families", () => {
    expect(renderCodexRecord(rollout({ type: "function_call_output", output: "exit 0" }))).toEqual([{ kind: "tool", text: "exit 0" }]);
    expect(renderCodexRecord(rollout({ type: "custom_tool_call_output", output: "exit 0" }))).toEqual([{ kind: "tool", text: "exit 0" }]);
  });

  it("says what a web search did, from its action", () => {
    const row = renderCodexRecord(rollout({ type: "web_search_call", action: { type: "open_page", url: "https://example.com/pr/1" } }));
    expect(row).toEqual([{ kind: "tool", text: "web_search open_page https://example.com/pr/1", call: true }]);
  });

  // The class fix, and the reason it is by SHAPE rather than by name: a tool record codex adds
  // tomorrow renders a row naming it instead of vanishing. Nothing in the store hits this today —
  // it is a tripwire, not a source of rows.
  it("names an unrecognised tool record rather than dropping it", () => {
    expect(renderCodexRecord(rollout({ type: "future_thing_call", name: "newtool" }))).toEqual([{ kind: "tool", text: "newtool", call: true }]);
    expect(renderCodexRecord(rollout({ type: "tool_search_output", tools: [{ name: "x" }] }))).toEqual([{ kind: "tool", text: "tool_search_output" }]);
  });

  // …and the other half of that rule: a NON-tool record must still render nothing, or the view
  // fills with the names of things that are not conversation.
  it("still renders nothing for a non-tool record type", () => {
    expect(renderCodexRecord(rollout({ type: "world_state", state: {} }))).toEqual([]);
    expect(renderCodexRecord(rollout({ type: "turn_context", cwd: "/tmp" }))).toEqual([]);
  });

  it("clips a long argument string rather than carrying the whole invocation", () => {
    const [row] = renderCodexRecord(rollout({ type: "function_call", name: "exec_command", arguments: "x".repeat(4000) }));
    expect(row?.text.length).toBeLessThan(260);
    expect(row?.text.endsWith("…")).toBe(true);
  });

  it("falls back to a name for a tool call that has none", () => {
    expect(renderCodexRecord(rollout({ type: "function_call", arguments: "" }))).toEqual([{ kind: "tool", text: "(unnamed tool)", call: true }]);
  });

  // The same cap claude's tool results get, and from the same function — a result must not be six
  // lines for one agent and whole for another.
  it("caps a tool result at claude's line budget and marks it clipped", () => {
    const out = Array.from({ length: TOOL_RESULT_MAX_LINES + 4 }, (_, i) => `line ${i}`).join("\n");
    const [row] = renderCodexRecord(rollout({ type: "function_call_output", output: out }));
    expect(row?.text.split("\n")).toHaveLength(TOOL_RESULT_MAX_LINES);
    expect(row?.clipped).toBe(true);
  });

  // `reasoning` is 6,172 records across 489 of 500 sampled rollouts and carries nothing readable:
  // `summary: []`, the body encrypted. The same treatment claude's `thinking` gets.
  it("renders nothing for reasoning, accounting and the item stream", () => {
    expect(renderCodexRecord(rollout({ type: "reasoning", summary: [], encrypted_content: "gAAAA" }))).toEqual([]);
    expect(renderCodexRecord(eventMsg({ type: "token_count", info: {} }))).toEqual([]);
    expect(renderCodexRecord(eventMsg({ type: "item_completed", item: {} }))).toEqual([]);
    expect(renderCodexRecord({ type: "session_meta", payload: { id: "x" } })).toEqual([]);
  });

  it("renders nothing for a record with no payload at all", () => {
    expect(renderCodexRecord({})).toEqual([]);
    expect(renderCodexRecord({ type: "response_item", payload: "not a record" })).toEqual([]);
  });
});

describe("createCodexFold", () => {
  it("opens a turn on the person's prompt and hangs the reply under it", () => {
    const scan = foldAll([userMessage("what changed?"), assistantMessage("this and that")]);
    expect(scan.turns).toHaveLength(1);
    expect(scan.turns[0]?.rows).toEqual([
      { kind: "user", text: "what changed?" },
      { kind: "assistant", text: "this and that" },
    ]);
  });

  // TRAP 1 again, at the fold rather than the renderer: codex's wrapper messages must not open
  // turns, or every exchange fuses into one the line budget can never evict.
  it("does not open a turn for codex's own preamble", () => {
    const scan = foldAll([userMessage("<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>"), assistantMessage("hi")]);
    expect(scan.turns).toHaveLength(0);
  });

  // TRAP 2, measured at 924 pairs in the store: one prompt written as a response_item and then
  // immediately again as an event_msg. Two turns here means every prompt shown twice, with an empty
  // turn between them.
  it("opens ONE turn for a prompt codex wrote in both shapes", () => {
    const scan = foldAll([userMessage("run the tests"), eventMsg({ type: "user_message", message: "run the tests" }), assistantMessage("done")]);
    expect(scan.turns).toHaveLength(1);
    expect(scan.turns[0]?.rows.filter((r) => r.kind === "user")).toHaveLength(1);
  });

  // The other side of that rule: a person really can send the same text twice, and those turns are
  // the same shape with a reply between them.
  it("keeps two turns when the person sent the same text twice", () => {
    const scan = foldAll([userMessage("again"), assistantMessage("ok"), userMessage("again"), assistantMessage("ok")]);
    expect(scan.turns).toHaveLength(2);
  });

  it("carries the boundary record's timestamp as the turn's start", () => {
    const scan = foldAll([userMessage("when")]);
    expect(scan.turns[0]?.at).toBe("2026-08-23T05:18:28.228Z");
  });

  it("drops a pre-boundary fragment and says the view is truncated", () => {
    const scan = foldAll([assistantMessage("tail of an older turn"), userMessage("new question")]);
    expect(scan.truncated).toBe(true);
    expect(scan.turns).toHaveLength(1);
  });

  it("answers `none` for a rollout with no prompt in the window", () => {
    expect(transcriptViewOf(foldAll([assistantMessage("orphan")]), false)).toEqual({ status: "none" });
  });
});

// ── the property harvested from the differential harness ──────────────────────────────────────
//
// `foldTranscriptView` is now `foldTurnRecord` plus claude's three readers. That decomposition is
// the thing the harness proved and the thing a future edit can silently break — a renderer moved
// into the wrong half, a sidechain check dropped, the timestamp read at the wrong level. The
// generator is the one from the harness: the record shapes that actually occur, plus the malformed
// ones that do not.
describe("claude's fold is exactly the shared fold plus claude's renderers", () => {
  const shapes: (() => Record<string, unknown>)[] = [
    () => ({ type: "user", message: { content: "hello" }, timestamp: "2026-09-15T00:00:00.000Z" }),
    () => ({ type: "user", message: { content: [{ type: "text", text: "block prompt" }] } }),
    () => ({ type: "user", isSidechain: true, message: { content: "sub-agent" } }),
    () => ({ type: "assistant", message: { content: [{ type: "text", text: "a\nb\nc" }] } }),
    () => ({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }),
    () => ({ type: "user", message: { content: [{ type: "tool_result", content: "1\n2\n3\n4\n5\n6\n7\n8" }] } }),
    () => ({ type: "assistant", message: { content: [{ type: "thinking", thinking: "" }] } }),
    () => ({ type: "assistant", message: { content: [{ type: "mystery", x: 1 }] } }),
    () => ({ type: "user", message: { content: `${"x".repeat(300)}\n${"y\n".repeat(300)}` } }),
    () => ({ type: "user", message: { content: "t" }, timestamp: "z".repeat(200) }),
    () => ({ type: "summary" }),
    () => ({ type: "user", message: {} }),
    () => ({}),
  ];

  const SEQUENCES = 2000;
  const LONGEST_SEQUENCE = 40;

  it("agrees over 2000 generated sequences", () => {
    const random = seededRandom(12345);
    const used = new Set<() => Record<string, unknown>>();
    const sequences = new Set<string>();
    for (let n = 0; n < SEQUENCES; n++) {
      const picked = Array.from({ length: 1 + random.below(LONGEST_SEQUENCE) }, () => random.pick(shapes));
      picked.forEach((shape) => used.add(shape));
      const records = picked.map((shape) => shape());
      sequences.add(JSON.stringify(records));
      const viaClaude = emptyTranscriptScan();
      const viaShared = emptyTranscriptScan();
      const claudeBoundary = emptyTurnBoundary();
      const sharedBoundary = emptyTurnBoundary();
      for (const record of records) {
        foldTranscriptView(viaClaude, record, claudeBoundary);
        // Claude's three readers, spelled out. A sidechain record is dropped WHOLE — not merely
        // disqualified as a boundary — or its rows land in whichever turn happens to be open.
        if (record.isSidechain === true) continue;
        foldTurnRecord(viaShared, {
          prompt: turnBoundaryPrompt(record, sharedBoundary),
          at: typeof record.timestamp === "string" ? record.timestamp : null,
          rows: renderRecord(record),
        });
      }
      expect(JSON.stringify(viaShared), `sequence ${n}`).toBe(JSON.stringify(viaClaude));
    }
    // Every shape, and sequences that are mostly distinct: a generator that cycles repeats them.
    expect(used.size).toBe(shapes.length);
    expect(sequences.size).toBeGreaterThan(SEQUENCES / 2);
  });
});
