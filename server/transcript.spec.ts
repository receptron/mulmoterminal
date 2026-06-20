import { describe, it, expect } from "vitest";
import { latestUserPromptFromJsonl, userPromptText, parseJsonl } from "./transcript.js";

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
