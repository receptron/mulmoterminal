// @vitest-environment node
import { describe, it, expect } from "vitest";

import { headerHookEffect, LAST_PROMPT_CAP } from "../../../server/session/header-hook.js";

describe("headerHookEffect", () => {
  it("records a submitted prompt as the session's query", () => {
    expect(headerHookEffect("UserPromptSubmit", { prompt: "  fix the login bug  " })).toEqual({ kind: "prompt", text: "fix the login bug" });
  });

  it("caps a pasted wall of text to one header line", () => {
    const effect = headerHookEffect("UserPromptSubmit", { prompt: "x".repeat(LAST_PROMPT_CAP + 50) });
    expect(effect).toEqual({ kind: "prompt", text: "x".repeat(LAST_PROMPT_CAP) });
  });

  // Blanking the header on an empty submit would erase the query the user is still waiting
  // on — so a blank or non-string prompt changes nothing rather than falling through.
  it.each([[""], ["   "], ["\n\t "], [null], [undefined], [42], [{ text: "hi" }], [["hi"]]])("ignores the unusable prompt %j", (prompt) => {
    expect(headerHookEffect("UserPromptSubmit", { prompt })).toBeNull();
  });

  it("clears the header when /clear restarts the conversation", () => {
    expect(headerHookEffect("SessionStart", { source: "clear" })).toEqual({ kind: "clear" });
  });

  // The distinction this rule exists for: /compact also arrives as SessionStart. Clearing on
  // it would wipe the user's task line and AI title mid-conversation.
  it.each([["compact"], ["startup"], ["resume"], [undefined], [null], ["CLEAR"]])("does not clear on SessionStart source %j", (source) => {
    expect(headerHookEffect("SessionStart", { source })).toBeNull();
  });

  it("regenerates the title once a turn's reply is on disk", () => {
    expect(headerHookEffect("Stop", {})).toEqual({ kind: "title" });
  });

  // Every other hook — the tool ones fire constantly — must leave the header alone.
  it.each([["PreToolUse"], ["PostToolUse"], ["PostToolUseFailure"], ["Notification"], ["SessionEnd"], [""], ["userpromptsubmit"]])(
    "changes nothing on %j",
    (event) => {
      expect(headerHookEffect(event, { prompt: "ignored", source: "clear" })).toBeNull();
    },
  );

  // Order matters, not just the mapping: a payload carrying both a prompt and a clear source
  // must be judged by its EVENT, never by whichever field is present.
  it("decides on the event, not on stray payload fields", () => {
    expect(headerHookEffect("Stop", { prompt: "still here", source: "clear" })).toEqual({ kind: "title" });
    expect(headerHookEffect("SessionStart", { prompt: "still here", source: "clear" })).toEqual({ kind: "clear" });
  });

  it("honours an explicit cap over the default", () => {
    expect(headerHookEffect("UserPromptSubmit", { prompt: "abcdef" }, 3)).toEqual({ kind: "prompt", text: "abc" });
  });
});
