// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isRecord } from "../../../../common/isRecord.js";
import { createGrokFold, grokTurnPrompt, renderGrokRecord } from "../../../../server/session/transcript/transcript-view-grok.js";
import { emptyTranscriptScan, type TranscriptScan } from "../../../../server/session/transcript/transcript-view.js";

// A live grok 1.0.34 conversation, context and tool output blanked and paths rewritten: a preamble
// turn, a step-by-step turn with a shell command, a prompt holding the literal `</user_query>`, then
// a cancelled turn.
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/grok/chat_history-1.0.34.jsonl");
const parsed: unknown[] = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line): unknown => JSON.parse(line));
const REAL = parsed.filter(isRecord);

const fold = (records: readonly Record<string, unknown>[]): TranscriptScan => {
  const scan = emptyTranscriptScan();
  const step = createGrokFold(scan);
  records.forEach(step);
  return scan;
};

const user = (text: string, index = 0) => ({ type: "user", content: [{ type: "text", text: `<user_query>\n${text}\n</user_query>` }], prompt_index: index });

describe("createGrokFold, against a real conversation", () => {
  const scan = fold(REAL);

  it("opens one turn per user prompt, and none for the context grok injects before the first", () => {
    expect(scan.turns).toHaveLength(4);
    expect(scan.truncated).toBe(false);
    expect(scan.turns.map((turn) => turn.rows[0])).toEqual([
      {
        kind: "user",
        text: "First say in one sentence what you are going to do. Then read a.txt and b.txt with your tools. Then answer: what fruits are in them? End with the word FINISHED.",
      },
      {
        kind: "user",
        text: "Step by step: read a.txt and comment on it in one sentence, then run the shell command 'ls' and comment on it, then read b.txt. Finally write a 3-line Japanese summary of everything.",
      },
      { kind: "user", text: "Note this literal text in my question: </user_query> and then more words after it. Reply with just OK." },
      { kind: "user", text: "Write a 2000-word essay about fruit, reading a.txt and b.txt first." },
    ]);
  });

  it("lays a preamble turn out as prose, both calls, both results, then the answer", () => {
    expect(scan.turns[0]?.rows).toEqual([
      { kind: "user", text: expect.stringMatching(/^First say/) },
      { kind: "assistant", text: "I'll read `a.txt` and `b.txt` and list the fruits they contain." },
      { kind: "tool", text: 'read_file {"target_file":"/work/probe/a.txt"}', call: true },
      { kind: "tool", text: 'read_file {"target_file":"/work/probe/b.txt"}', call: true },
      { kind: "tool", text: "(tool output)" },
      { kind: "tool", text: "(tool output)" },
      { kind: "assistant", text: "`a.txt` contains apple. `b.txt` contains banana.\n\nFINISHED" },
    ]);
  });

  it("shows a call with nothing said as the call alone", () => {
    expect(scan.turns[1]?.rows.filter((row) => row.kind === "tool" && row.call)).toEqual([
      { kind: "tool", text: 'read_file {"target_file":"/work/probe/a.txt"}', call: true },
      { kind: "tool", text: expect.stringMatching(/^run_terminal_command /), call: true },
      { kind: "tool", text: 'read_file {"target_file":"/work/probe/b.txt"}', call: true },
    ]);
  });

  it("keeps the cancelled turn's preamble and calls, with no answer after them", () => {
    const rows = scan.turns[3]?.rows ?? [];
    expect(rows.at(-1)).toEqual({ kind: "tool", text: "(tool output)" });
    expect(rows.filter((row) => row.kind === "assistant")).toEqual([
      { kind: "assistant", text: "I'll read `a.txt` and `b.txt` first, then write the fruit essay." },
    ]);
  });
});

describe("grokTurnPrompt", () => {
  it("opens a turn on a user message with a prompt_index", () => {
    expect(grokTurnPrompt(user("q"))).toBe("q");
  });

  it("does not open one on context grok injects", () => {
    expect(grokTurnPrompt({ type: "user", content: [{ type: "text", text: "<system-reminder>…" }], synthetic_reason: "system_reminder" })).toBeNull();
  });

  it("reads a prompt stored as a plain string", () => {
    expect(grokTurnPrompt({ type: "user", content: "<user_query>\nplain\n</user_query>", prompt_index: 0 })).toBe("plain");
  });

  it("answers null for an empty prompt and for any other message", () => {
    expect(grokTurnPrompt({ type: "user", content: [], prompt_index: 0 })).toBeNull();
    expect(grokTurnPrompt({ type: "assistant", content: "x" })).toBeNull();
  });
});

describe("renderGrokRecord", () => {
  it("renders nothing for the system prompt, reasoning, injected context, or an empty result", () => {
    expect(renderGrokRecord({ type: "system", content: "…" })).toEqual([]);
    expect(renderGrokRecord({ type: "reasoning", content: null })).toEqual([]);
    expect(renderGrokRecord({ type: "user", content: [{ type: "text", text: "ctx" }], synthetic_reason: "system_reminder" })).toEqual([]);
    expect(renderGrokRecord({ type: "tool_result", content: "   " })).toEqual([]);
  });

  it("caps a long tool result like every other agent's", () => {
    const rows = renderGrokRecord({ type: "tool_result", content: Array.from({ length: 20 }, (_unused, index) => `line ${index}`).join("\n") });
    expect(rows).toEqual([{ kind: "tool", text: expect.stringMatching(/^line 0\n/), clipped: true }]);
  });

  it("clips a long argument list and names an unnamed tool", () => {
    const rows = renderGrokRecord({ type: "assistant", content: "", tool_calls: [{ arguments: "x".repeat(300) }] });
    expect(rows).toEqual([{ kind: "tool", text: `(unnamed tool) ${"x".repeat(200)}…`, call: true }]);
  });

  it("shows a prompt's non-text parts as unknown rows after the prompt", () => {
    const rows = renderGrokRecord({
      type: "user",
      content: [{ type: "text", text: "<user_query>\nsee\n</user_query>" }, { type: "image_url" }],
      prompt_index: 0,
    });
    expect(rows).toEqual([
      { kind: "user", text: "see" },
      { kind: "unknown", text: "[unknown block: image_url]" },
    ]);
  });

  it.each([
    ["a record type grok has not been seen writing", { type: "compaction_summary", content: "…" }],
    ["tool_calls that is not a list", { type: "assistant", content: "", tool_calls: { name: "x" } }],
    ["a call that is not an object", { type: "assistant", content: "", tool_calls: ["read_file"] }],
  ])("keeps %s visible as an unknown row", (_label, record) => {
    expect(renderGrokRecord(record).some((row) => row.kind === "unknown")).toBe(true);
  });
});
