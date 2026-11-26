// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isRecord } from "../../../../common/isRecord.js";
import { antigravityTurnPrompt, createAntigravityFold, renderAntigravityStep } from "../../../../server/session/transcript/transcript-view-antigravity.js";
import { emptyTranscriptScan, type TranscriptScan } from "../../../../server/session/transcript/transcript-view.js";

// A live agy 1.3.5 session, tool output bodies blanked and paths rewritten: a preamble turn, a
// step-by-step turn with two commentaries and a shell command, then an interrupted turn.
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/antigravity/transcript-1.3.5.jsonl");
const parsed: unknown[] = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line): unknown => JSON.parse(line));
const REAL = parsed.filter(isRecord);

const fold = (records: readonly Record<string, unknown>[]): TranscriptScan => {
  const scan = emptyTranscriptScan();
  const step = createAntigravityFold(scan);
  records.forEach(step);
  return scan;
};

const user = (text: string) => ({
  source: "USER_EXPLICIT",
  type: "USER_INPUT",
  status: "DONE",
  created_at: "2026-11-21T03:36:28Z",
  content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>`,
});
const output = (type: string, body: string) => ({
  source: "MODEL",
  type,
  status: "DONE",
  content: `Created At: 2026-11-21T12:36:32+09:00\nCompleted At: 2026-11-21T12:36:32+09:00\n${body}`,
});

describe("createAntigravityFold, against a real session", () => {
  const scan = fold(REAL);

  it("opens one turn per USER_INPUT, stamped with its created_at", () => {
    expect(scan.truncated).toBe(false);
    expect(scan.turns.map((turn) => [turn.at, turn.rows[0]?.text])).toEqual([
      [
        "2026-11-21T03:36:21Z",
        "First say in one sentence what you are going to do. Then read a.txt and b.txt with your tools. Then answer: what fruits are in them? End with the word FINISHED.",
      ],
      [
        expect.any(String),
        "Step by step: read a.txt and comment on it in one sentence, then run the shell command 'ls' and comment on it, then read b.txt. Finally write a 3-line Japanese summary of everything.",
      ],
      [expect.any(String), "Write a 2000-word essay about fruit, reading a.txt and b.txt first."],
    ]);
  });

  it("lays a preamble turn out as prose, both calls with decoded arguments, both outputs without their stamps, then the answer", () => {
    expect(scan.turns[0]?.rows).toEqual([
      { kind: "user", text: expect.stringMatching(/^First say/) },
      { kind: "assistant", text: "I will read `a.txt` and `b.txt` using file tools to find and list all the fruits mentioned in them." },
      { kind: "tool", text: 'read_file {"Path":"/work/probe/a.txt"}', call: true },
      { kind: "tool", text: 'read_file {"Path":"/work/probe/b.txt"}', call: true },
      { kind: "tool", text: "(tool output)" },
      { kind: "tool", text: "(tool output)" },
      { kind: "assistant", text: expect.stringMatching(/^The fruits found in the files are:[\s\S]*FINISHED$/) },
    ]);
  });

  it("shows the interrupted turn's calls and outputs, and nothing for the empty response the interrupt left", () => {
    const rows = scan.turns[2]?.rows ?? [];
    expect(rows.filter((row) => row.kind === "assistant")).toEqual([]);
    expect(rows.at(-1)).toEqual({ kind: "tool", text: "(tool output)" });
  });
});

describe("antigravityTurnPrompt", () => {
  it("unwraps a USER_INPUT", () => {
    expect(antigravityTurnPrompt(user("q"))).toBe("q");
  });

  it("answers null for an empty prompt and for any other step", () => {
    expect(antigravityTurnPrompt({ type: "USER_INPUT", content: "  " })).toBeNull();
    expect(antigravityTurnPrompt({ type: "USER_INPUT" })).toBeNull();
    expect(antigravityTurnPrompt({ type: "PLANNER_RESPONSE", content: "x" })).toBeNull();
  });
});

describe("renderAntigravityStep", () => {
  it("renders nothing for SYSTEM steps or a MODEL step with no content", () => {
    expect(renderAntigravityStep({ source: "SYSTEM", type: "CONVERSATION_HISTORY", status: "DONE" })).toEqual([]);
    expect(renderAntigravityStep({ source: "SYSTEM", type: "CHECKPOINT", status: "DONE", content: "{{ CHECKPOINT 0 }}" })).toEqual([]);
    expect(renderAntigravityStep({ source: "MODEL", type: "GENERIC", status: "DONE" })).toEqual([]);
  });

  it("shows a tool output of any type, without the two timestamp lines", () => {
    expect(renderAntigravityStep(output("VIEW_FILE", "File Path: x\n1: a"))).toEqual([{ kind: "tool", text: "File Path: x\n1: a" }]);
    expect(renderAntigravityStep(output("LIST_DIRECTORY", '{"name":"src"}'))).toEqual([{ kind: "tool", text: '{"name":"src"}' }]);
  });

  it("keeps a timestamp-like line that is not at the top of the output", () => {
    expect(renderAntigravityStep(output("GENERIC", "Created At: inside the body"))).toEqual([{ kind: "tool", text: "Created At: inside the body" }]);
  });

  it("caps a long output like every other agent's", () => {
    const rows = renderAntigravityStep(output("GENERIC", Array.from({ length: 20 }, (_unused, index) => `line ${index}`).join("\n")));
    expect(rows).toEqual([{ kind: "tool", text: expect.stringMatching(/^line 0\n/), clipped: true }]);
  });

  it("decodes each argument one level, and leaves a value that is not JSON as it is", () => {
    const rows = renderAntigravityStep({
      type: "PLANNER_RESPONSE",
      tool_calls: [{ name: "run_command", args: { CommandLine: '"echo hi"', WaitMsBeforeAsync: "5000", Raw: "not json" } }],
    });
    expect(rows).toEqual([{ kind: "tool", text: 'run_command {"CommandLine":"echo hi","WaitMsBeforeAsync":5000,"Raw":"not json"}', call: true }]);
  });

  it("clips long arguments and names an unnamed tool", () => {
    const rows = renderAntigravityStep({ type: "PLANNER_RESPONSE", tool_calls: [{ args: { Text: JSON.stringify("x".repeat(300)) } }] });
    expect(rows).toEqual([{ kind: "tool", text: expect.stringMatching(/^\(unnamed tool\) \{"Text":"x+…$/), call: true }]);
  });

  it("renders the empty response an interrupt leaves as nothing", () => {
    expect(renderAntigravityStep({ source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: null })).toEqual([]);
  });

  it.each([
    ["tool_calls that is not a list", { type: "PLANNER_RESPONSE", content: "", tool_calls: { name: "x" } }],
    ["a call that is not an object", { type: "PLANNER_RESPONSE", content: "", tool_calls: ["read_file"] }],
    ["a step from a source agy has not been seen writing", { source: "BROWSER", type: "SCREENSHOT", content: "…" }],
    ["a MODEL step whose content is not text", { source: "MODEL", type: "GENERIC", content: { body: "x" } }],
  ])("keeps %s visible as an unknown row", (_label, record) => {
    expect(renderAntigravityStep(record).some((row) => row.kind === "unknown")).toBe(true);
  });
});

describe("createAntigravityFold, an artifact approval", () => {
  const approval = {
    source: "USER_EXPLICIT",
    type: "USER_INPUT",
    status: "DONE",
    created_at: "2026-05-20T22:06:29Z",
    content: "Comments on artifact URI: file:///w/implementation_plan.md\n\nThe user has approved this document.\n\n<USER_REQUEST>\n\n</USER_REQUEST>",
  };

  it("opens its own turn, so the work after it is not folded into the turn that asked for the plan", () => {
    const scan = fold([user("make a plan"), output("CODE_ACTION", "Created file plan"), approval, output("CODE_ACTION", "Created file impl")]);
    expect(scan.turns.map((turn) => [turn.at, turn.rows.map((row) => row.text)])).toEqual([
      [expect.any(String), ["make a plan", "Created file plan"]],
      ["2026-05-20T22:06:29Z", ["Comments on artifact URI: file:///w/implementation_plan.md\n\nThe user has approved this document.", "Created file impl"]],
    ]);
  });
});
