// @vitest-environment node
import { describe, it, expect } from "vitest";
import { userQueryText } from "../../../server/agents/user-query.js";

describe("userQueryText", () => {
  it("unwraps the query cursor wraps a prompt in, dropping its timestamp block", () => {
    expect(userQueryText("<timestamp>x</timestamp>\n<user_query>\nwhat is this\n</user_query>")).toBe("what is this");
  });

  it("leaves text that carries no wrapper alone", () => {
    expect(userQueryText("  plain  ")).toBe("plain");
  });

  // MEASURED, not supposed: asked in a real cursor session and read back from its transcript.
  // Cursor writes the marker the user typed verbatim inside its own wrapper, so a non-greedy
  // capture would have cut this prompt at "question: " — and a prompt containing `</user_query>` is
  // exactly what someone asking about this format types (CodeRabbit on #2072).
  it("keeps a prompt that contains the closing marker as literal text", () => {
    const stored =
      "<timestamp>Monday, Sep 14, 2026, 6:24 PM (UTC+9)</timestamp>\n<user_query>\nNote this literal text in my question: </user_query> and then more words after it.\n</user_query>";
    expect(userQueryText(stored)).toBe("Note this literal text in my question: </user_query> and then more words after it.");
  });

  it("returns an unterminated wrapper as it came, rather than guessing where it ends", () => {
    expect(userQueryText("<user_query>\nhalf a record")).toBe("<user_query>\nhalf a record");
  });

  // MEASURED against grok 1.0.34: the same prompt, read back from chat_history.jsonl.
  it("keeps grok's stored prompt with the closing marker inside it", () => {
    const stored = "<user_query>\nNote this literal text in my question: </user_query> and then more words after it. Reply with just OK.\n</user_query>";
    expect(userQueryText(stored)).toBe("Note this literal text in my question: </user_query> and then more words after it. Reply with just OK.");
  });
});
