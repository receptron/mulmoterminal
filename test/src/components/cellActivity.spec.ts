import { describe, it, expect } from "vitest";

import { applyActivityPush, cellHeaderText, type CellActivityState } from "../../../src/components/cellActivity";

const shown: CellActivityState = { working: true, waiting: false, event: "Stop", lastPrompt: "fix the login bug", aiTitle: "Login fix" };

describe("applyActivityPush", () => {
  it("takes the flags the push carries", () => {
    expect(applyActivityPush(shown, { working: false, waiting: true })).toMatchObject({ working: false, waiting: true });
  });

  // Absent means FALSE for the flags: a push that omits them is saying the session is not
  // doing that. Keep the previous value and a finished session goes on pulsing.
  it("treats an omitted flag as not-doing-that, not as no-news", () => {
    expect(applyActivityPush(shown, {})).toMatchObject({ working: false, waiting: false });
  });

  // The opposite for the text: absent means no news…
  it("keeps the prompt and title a push says nothing about", () => {
    expect(applyActivityPush(shown, {})).toMatchObject({ lastPrompt: "fix the login bug", aiTitle: "Login fix" });
  });

  // …and an explicit null means there is none now. Collapse the two and a cleared or
  // restarted session keeps displaying the conversation the user just ended.
  it("clears the prompt and title on an explicit null", () => {
    expect(applyActivityPush(shown, { lastPrompt: null, aiTitle: null })).toMatchObject({ lastPrompt: null, aiTitle: null });
  });

  it("clears one without disturbing the other", () => {
    expect(applyActivityPush(shown, { aiTitle: null })).toMatchObject({ lastPrompt: "fix the login bug", aiTitle: null });
  });

  it("keeps the event when the push omits it, and clears it on an explicit null", () => {
    expect(applyActivityPush(shown, {}).event).toBe("Stop");
    expect(applyActivityPush(shown, { event: null }).event).toBeNull();
  });

  it("does not mutate the state it was given", () => {
    applyActivityPush(shown, { working: false, lastPrompt: null });
    expect(shown).toEqual({ working: true, waiting: false, event: "Stop", lastPrompt: "fix the login bug", aiTitle: "Login fix" });
  });
});

describe("cellHeaderText", () => {
  it("prefers our summary", () => {
    expect(cellHeaderText("Login fix", "fix the login bug", "abcdef12-3456")).toBe("Login fix");
  });

  it("falls back to the last prompt", () => {
    expect(cellHeaderText(null, "fix the login bug", "abcdef12-3456")).toBe("fix the login bug");
  });

  // Enough of the id to tell two untitled cells apart.
  it("falls back to a short session id", () => {
    expect(cellHeaderText(null, null, "abcdef12-3456")).toBe("abcdef12");
  });

  it("says a session has not reported anything yet", () => {
    expect(cellHeaderText(null, null, null)).toBe("starting…");
  });

  // An empty title is nothing to show, not a value — `||`, not `??`.
  it("skips an empty title and an empty prompt", () => {
    expect(cellHeaderText("", "fix the login bug", "abcdef12")).toBe("fix the login bug");
    expect(cellHeaderText("", "", "abcdef12")).toBe("abcdef12");
  });
});
