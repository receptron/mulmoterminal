import { describe, it, expect } from "vitest";
import {
  latestUserPromptFromJsonl,
  latestMeaningfulUserPromptFromJsonl,
  isTrivialPrompt,
  preferredHeaderPrompt,
  userPromptText,
  parseJsonl,
  sessionUsageFromJsonl,
  latestTurnContextFromJsonl,
  timelineFromJsonl,
} from "./transcript.js";

const line = (o: unknown) => JSON.stringify(o);

describe("latestUserPromptFromJsonl", () => {
  it("returns the last user-typed prompt (string content)", () => {
    const raw = [
      line({ type: "user", message: { content: "first prompt" } }),
      line({ type: "assistant", message: { content: "ok" } }),
      line({ type: "user", message: { content: "second prompt" } }),
    ].join("\n");
    expect(latestUserPromptFromJsonl(raw)).toBe("second prompt");
  });

  it("handles array block content", () => {
    const raw = line({
      type: "user",
      message: {
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
      },
    });
    expect(latestUserPromptFromJsonl(raw)).toBe("hello world");
  });

  it("skips slash/local-command wrappers (not real typed prompts)", () => {
    const raw = [
      line({ type: "user", message: { content: "real prompt" } }),
      line({ type: "user", message: { content: "<local-command>/clear</local-command>" } }),
    ].join("\n");
    expect(latestUserPromptFromJsonl(raw)).toBe("real prompt");
  });

  it("falls back to a last-prompt record when there are no user lines", () => {
    const raw = [line({ type: "assistant", message: { content: "hi" } }), line({ type: "last-prompt", lastPrompt: "from record" })].join("\n");
    expect(latestUserPromptFromJsonl(raw)).toBe("from record");
  });

  it("prefers a user line over a last-prompt record", () => {
    const raw = [line({ type: "last-prompt", lastPrompt: "record" }), line({ type: "user", message: { content: "typed" } })].join("\n");
    expect(latestUserPromptFromJsonl(raw)).toBe("typed");
  });

  it("returns null for an empty transcript", () => {
    expect(latestUserPromptFromJsonl("")).toBeNull();
  });

  it("tolerates blank and malformed lines", () => {
    const raw = ["", "not json", line({ type: "user", message: { content: "ok" } }), "{bad"].join("\n");
    expect(latestUserPromptFromJsonl(raw)).toBe("ok");
  });
});

describe("isTrivialPrompt", () => {
  it("treats empty / ack words / bare commands / a lone char as trivial", () => {
    for (const t of ["", "  ", "ok", "OK", " ok. ", "yes", "はい", "うん", "マージ", "merge", "okay", "sure", "続けて", "お願いします", "y", "k", "👍"]) {
      expect(isTrivialPrompt(t)).toBe(true);
    }
  });
  it("treats a substantial prompt as meaningful — including short, non-ack terms", () => {
    // Regression for the i18n / terse-prompt false-positive: length alone must not
    // mark short-but-meaningful prompts trivial.
    for (const t of ["Fix the parser bug", "deploy to prod", "バグ直して", "UI", "DB", "修正", "対応", "fix", "api"]) {
      expect(isTrivialPrompt(t)).toBe(false);
    }
  });
});

describe("preferredHeaderPrompt", () => {
  it("uses a meaningful incoming prompt (over null or anything)", () => {
    expect(preferredHeaderPrompt(null, "Fix the bug")).toBe("Fix the bug");
    expect(preferredHeaderPrompt("old task", "new task here")).toBe("new task here");
    expect(preferredHeaderPrompt("ok", "Fix the bug")).toBe("Fix the bug");
  });
  it("keeps a meaningful current prompt when the incoming is trivial", () => {
    expect(preferredHeaderPrompt("Fix the parser bug", "ok")).toBe("Fix the parser bug");
    expect(preferredHeaderPrompt("Fix the parser bug", "マージ")).toBe("Fix the parser bug");
  });
  it("tracks the latest trivial prompt when there's nothing meaningful yet", () => {
    expect(preferredHeaderPrompt(null, "ok")).toBe("ok"); // first prompt, even if trivial
    expect(preferredHeaderPrompt("ok", "merge")).toBe("merge"); // trivial replaces trivial
  });
});

describe("latestMeaningfulUserPromptFromJsonl", () => {
  const user = (content: string) => line({ type: "user", message: { content } });

  it("skips trailing trivial acks and returns the last substantial prompt", () => {
    const raw = [user("Fix the parser bug"), user("ok"), user("merge")].join("\n");
    expect(latestMeaningfulUserPromptFromJsonl(raw)).toBe("Fix the parser bug");
  });

  it("returns the most recent substantial prompt when interleaved with acks", () => {
    const raw = [user("task A"), user("ok"), user("now add the tests"), user("はい")].join("\n");
    expect(latestMeaningfulUserPromptFromJsonl(raw)).toBe("now add the tests");
  });

  it("falls back to the latest prompt when every prompt is trivial", () => {
    expect(latestMeaningfulUserPromptFromJsonl([user("ok"), user("はい")].join("\n"))).toBe("はい");
  });

  it("falls back to a last-prompt record when there are no user lines", () => {
    expect(latestMeaningfulUserPromptFromJsonl(line({ type: "last-prompt", lastPrompt: "from record" }))).toBe("from record");
  });

  it("returns null for an empty transcript", () => {
    expect(latestMeaningfulUserPromptFromJsonl("")).toBeNull();
  });
});

describe("userPromptText", () => {
  it("trims and returns plain text", () => {
    expect(userPromptText("  hi  ")).toBe("hi");
  });
  it("rejects empty / whitespace", () => {
    expect(userPromptText("   ")).toBeNull();
  });
  it("rejects command wrappers", () => {
    expect(userPromptText("<bash-input>ls</bash-input>")).toBeNull();
  });
});

describe("parseJsonl", () => {
  it("keeps valid object lines and skips blank / malformed ones", () => {
    expect(parseJsonl(['{"a":1}', "", "oops", '{"b":2}'].join("\n"))).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe("sessionUsageFromJsonl", () => {
  const assistant = (usage: Record<string, number>) => line({ type: "assistant", message: { usage } });
  it("sums usage across every assistant turn", () => {
    const raw = [
      line({ type: "user", message: { content: "hi" } }),
      assistant({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 }),
      assistant({ input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 }),
    ].join("\n");
    expect(sessionUsageFromJsonl(raw)).toEqual({ inputTokens: 300, outputTokens: 60, cacheReadTokens: 55, cacheCreationTokens: 3 });
  });
  it("ignores non-assistant lines and assistant lines without usage", () => {
    const raw = [
      line({ type: "user", message: { content: "hi" } }),
      line({ type: "assistant", message: {} }), // no usage
      assistant({ input_tokens: 10, output_tokens: 2 }), // missing cache fields default to 0
      "malformed",
    ].join("\n");
    expect(sessionUsageFromJsonl(raw)).toEqual({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });
  it("is all-zero for an empty / promptless transcript", () => {
    expect(sessionUsageFromJsonl("")).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });
});

describe("latestTurnContextFromJsonl", () => {
  const assistant = (model: string, usage: Record<string, number>) => line({ type: "assistant", message: { model, usage } });

  it("returns the LAST turn's input + both cache buckets (not the cumulative sum)", () => {
    const raw = [
      line({ type: "user", message: { content: "hi" } }),
      assistant("claude-opus-4-20250101", { input_tokens: 100, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 }),
      assistant("claude-opus-4-20250101", { input_tokens: 200, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 1_000 }),
    ].join("\n");
    // Only the final turn: 200 + 50000 + 1000 (NOT summed with the first turn).
    expect(latestTurnContextFromJsonl(raw)).toEqual({ model: "claude-opus-4-20250101", contextTokens: 51_200 });
  });

  it("tracks the most recent model across turns", () => {
    const raw = [assistant("claude-sonnet-4-20250101", { input_tokens: 10 }), assistant("claude-opus-4-20250101", { input_tokens: 20 })].join("\n");
    expect(latestTurnContextFromJsonl(raw).model).toBe("claude-opus-4-20250101");
  });

  it("treats missing cache buckets as zero", () => {
    const raw = assistant("claude-haiku-4", { input_tokens: 42 });
    expect(latestTurnContextFromJsonl(raw)).toEqual({ model: "claude-haiku-4", contextTokens: 42 });
  });

  it("keeps a model even when the final turn carries no usage", () => {
    const raw = [assistant("claude-opus-4", { input_tokens: 300 }), line({ type: "assistant", message: { model: "claude-opus-4" } })].join("\n");
    // model still resolves; contextTokens holds the last turn that HAD usage.
    expect(latestTurnContextFromJsonl(raw)).toEqual({ model: "claude-opus-4", contextTokens: 300 });
  });

  it("is empty for an empty / promptless transcript", () => {
    expect(latestTurnContextFromJsonl("")).toEqual({ model: null, contextTokens: 0 });
  });

  it("ignores non-assistant and malformed lines", () => {
    const raw = [line({ type: "user", message: { content: "hi" } }), "not json", assistant("gpt-5-codex", { input_tokens: 7 })].join("\n");
    expect(latestTurnContextFromJsonl(raw)).toEqual({ model: "gpt-5-codex", contextTokens: 7 });
  });
});

describe("timelineFromJsonl", () => {
  const toolTurn = (ts: string, blocks: unknown[]) => line({ type: "assistant", timestamp: ts, message: { content: blocks } });
  const bash = (command: string) => ({ type: "tool_use", name: "Bash", input: { command, description: "d" } });
  const read = (file_path: string) => ({ type: "tool_use", name: "Read", input: { file_path } });

  it("returns [] for an empty transcript", () => {
    expect(timelineFromJsonl("")).toEqual([]);
  });

  it("extracts tool_use events with tool name + a summary of the key input", () => {
    const raw = [
      line({ type: "user", message: { content: "go" } }),
      toolTurn("2026-06-29T04:42:01.468Z", [bash("git status")]),
      toolTurn("2026-06-29T04:42:12.806Z", [read("/a/b/GridView.vue")]),
    ].join("\n");
    expect(timelineFromJsonl(raw)).toEqual([
      { ts: "2026-06-29T04:42:01.468Z", tool: "Bash", summary: "git status" },
      { ts: "2026-06-29T04:42:12.806Z", tool: "Read", summary: "/a/b/GridView.vue" },
    ]);
  });

  it("emits one event per tool_use block in a turn and ignores text blocks", () => {
    const raw = toolTurn("2026-06-29T04:42:01.468Z", [{ type: "text", text: "thinking" }, bash("ls"), read("/x.ts")]);
    const events = timelineFromJsonl(raw);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.tool)).toEqual(["Bash", "Read"]);
  });

  it("collapses whitespace and truncates a long summary", () => {
    const long = "echo " + "x".repeat(200);
    const [ev] = timelineFromJsonl(toolTurn("2026-06-29T04:42:01.468Z", [bash(long)]));
    expect(ev.summary).toHaveLength(141); // 140 chars + the ellipsis
    expect(ev.summary.endsWith("…")).toBe(true);
  });

  it("ignores non-assistant records and malformed lines", () => {
    const raw = [line({ type: "user", message: { content: "hi" } }), "not json", line({ type: "assistant", message: {} })].join("\n");
    expect(timelineFromJsonl(raw)).toEqual([]);
  });

  it("uses an empty ts when the record has no timestamp", () => {
    const raw = line({ type: "assistant", message: { content: [bash("pwd")] } });
    expect(timelineFromJsonl(raw)[0].ts).toBe("");
  });
});
