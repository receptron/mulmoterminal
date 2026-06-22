import { describe, it, expect } from "vitest";
import {
  latestUserPromptFromJsonl,
  latestMeaningfulUserPromptFromJsonl,
  isTrivialPrompt,
  preferredHeaderPrompt,
  userPromptText,
  parseJsonl,
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
