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
  aiTitleFromJsonl,
  conversationTurnsFromJsonl,
  countUserTurnsFromJsonl,
  latestAssistantTextFromJsonl,
  latestMeaningfulUserPromptFromParsed,
  aiTitleFromParsed,
  latestAssistantTextFromParsed,
  countUserTurnsFromParsed,
  sessionUsageFromParsed,
  latestTurnContextFromParsed,
} from "../../../server/session/transcript";

const line = (o: unknown) => JSON.stringify(o);

describe("latestAssistantTextFromJsonl", () => {
  it("returns the most recent assistant prose turn", () => {
    const raw = [
      line({ type: "user", message: { content: "do X" } }),
      line({ type: "assistant", message: { content: [{ type: "text", text: "first reply" }] } }),
      line({ type: "user", message: { content: "then Y" } }),
      line({ type: "assistant", message: { content: [{ type: "text", text: "second reply" }] } }),
    ].join("\n");
    expect(latestAssistantTextFromJsonl(raw)).toBe("second reply");
  });

  it("skips a tool-only assistant turn (no prose)", () => {
    const raw = [
      line({ type: "assistant", message: { content: [{ type: "text", text: "here goes" }] } }),
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } }),
    ].join("\n");
    expect(latestAssistantTextFromJsonl(raw)).toBe("here goes");
  });

  it("is null when there's no assistant text yet", () => {
    expect(latestAssistantTextFromJsonl(line({ type: "user", message: { content: "hi" } }))).toBeNull();
    expect(latestAssistantTextFromJsonl("")).toBeNull();
  });
});

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

// readSessionSummary parses the transcript ONCE and derives every field from that single
// array; these lock the *FromParsed variants to their *FromJsonl wrappers so the shared
// parse can't silently drift from the per-helper parse.
describe("*FromParsed matches *FromJsonl on one shared parse", () => {
  const raw = [
    line({ type: "user", message: { content: "Build the thing" } }),
    line({
      type: "assistant",
      message: {
        model: "claude-opus-4-8",
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 },
        content: [{ type: "text", text: "On it." }],
      },
    }),
    line({ type: "user", message: { content: "ok" } }),
    line({ type: "ai-title", aiTitle: "Thing builder" }),
    line({
      type: "assistant",
      message: {
        model: "claude-opus-4-8",
        usage: { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
        content: [{ type: "text", text: "Done." }],
      },
    }),
  ].join("\n");
  const records = parseJsonl(raw);

  it("derives the same six summary fields from the parsed array", () => {
    expect(latestMeaningfulUserPromptFromParsed(records)).toBe(latestMeaningfulUserPromptFromJsonl(raw));
    expect(latestMeaningfulUserPromptFromParsed(records)).toBe("Build the thing"); // "ok" is trivial → skipped
    expect(aiTitleFromParsed(records)).toBe(aiTitleFromJsonl(raw));
    expect(latestAssistantTextFromParsed(records)).toBe(latestAssistantTextFromJsonl(raw));
    expect(countUserTurnsFromParsed(records)).toBe(countUserTurnsFromJsonl(raw));
    expect(sessionUsageFromParsed(records)).toEqual(sessionUsageFromJsonl(raw));
    expect(latestTurnContextFromParsed(records)).toEqual(latestTurnContextFromJsonl(raw));
    expect(latestTurnContextFromParsed(records)).toEqual({ model: "claude-opus-4-8", contextTokens: 250 }); // last turn: 200+50+0
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

  it("zeroes context when the final turn carries no usage (no stale value from a prior turn)", () => {
    const raw = [assistant("claude-opus-4", { input_tokens: 300 }), line({ type: "assistant", message: { model: "claude-opus-4" } })].join("\n");
    // Both fields come from the SAME final turn: the model resolves, but with no usage
    // on that turn we report 0 rather than the previous turn's stale 300.
    expect(latestTurnContextFromJsonl(raw)).toEqual({ model: "claude-opus-4", contextTokens: 0 });
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

describe("aiTitleFromJsonl", () => {
  it("returns the last ai-title record's text", () => {
    const raw = [line({ type: "ai-title", aiTitle: "old" }), line({ type: "ai-title", aiTitle: "newest" })].join("\n");
    expect(aiTitleFromJsonl(raw)).toBe("newest");
  });

  it("returns null when there is no ai-title record", () => {
    expect(aiTitleFromJsonl(line({ type: "user", message: { content: "hi" } }))).toBeNull();
    expect(aiTitleFromJsonl("")).toBeNull();
  });
});

describe("conversationTurnsFromJsonl", () => {
  it("collects user and assistant text turns in order", () => {
    const raw = [
      line({ type: "user", message: { content: "fix the parser" } }),
      line({ type: "assistant", message: { content: [{ type: "text", text: "Looking at it" }] } }),
      line({ type: "user", message: { content: "2番目にして" } }),
    ].join("\n");
    expect(conversationTurnsFromJsonl(raw)).toEqual([
      { role: "user", text: "fix the parser" },
      { role: "assistant", text: "Looking at it" },
      { role: "user", text: "2番目にして" },
    ]);
  });

  it("skips slash/local-command user wrappers and tool-only assistant turns", () => {
    const raw = [
      line({ type: "user", message: { content: "<local-command>/clear</local-command>" } }),
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } }),
      line({ type: "user", message: { content: "real prompt" } }),
    ].join("\n");
    expect(conversationTurnsFromJsonl(raw)).toEqual([{ role: "user", text: "real prompt" }]);
  });

  it("joins multiple assistant text blocks and ignores tool_use blocks", () => {
    const raw = line({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "part one" },
          { type: "tool_use", name: "Read" },
          { type: "text", text: "part two" },
        ],
      },
    });
    expect(conversationTurnsFromJsonl(raw)).toEqual([{ role: "assistant", text: "part one part two" }]);
  });
});

describe("countUserTurnsFromJsonl", () => {
  it("counts only user turns, skipping assistant turns and command wrappers", () => {
    const raw = [
      line({ type: "user", message: { content: "first" } }),
      line({ type: "assistant", message: { content: [{ type: "text", text: "reply" }] } }),
      line({ type: "user", message: { content: "<local-command>/clear</local-command>" } }),
      line({ type: "user", message: { content: "second" } }),
    ].join("\n");
    expect(countUserTurnsFromJsonl(raw)).toBe(2);
  });

  it("is 0 for an empty transcript", () => {
    expect(countUserTurnsFromJsonl("")).toBe(0);
  });
});
