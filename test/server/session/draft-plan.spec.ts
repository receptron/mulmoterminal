// @vitest-environment node
import { describe, it, expect } from "vitest";

import { planDraftInjection } from "../../../server/session/draft-plan.js";

const identity = (s: string) => s;

describe("planDraftInjection", () => {
  it("is a no-op when neither prompt nor draft is given", () => {
    expect(planDraftInjection(undefined, undefined, identity)).toBeNull();
  });

  // An initialPrompt is typed AND submitted — it is meant to run on its own.
  it("auto-submits an initialPrompt", () => {
    expect(planDraftInjection("run me", undefined, identity)).toEqual({ text: "run me", autoSubmit: true });
  });

  // A draft is typed but NOT submitted, so the user reviews and sends it. This asymmetry is the
  // whole point: an auto-submitted draft would fire unreviewed text.
  it("never auto-submits a draft", () => {
    expect(planDraftInjection(undefined, "edit me", identity)).toEqual({ text: "edit me", autoSubmit: false });
  });

  // A draft takes precedence over an initialPrompt when both are present — and it still does not
  // auto-submit, even though an initialPrompt was also supplied.
  it("prefers the draft over the initialPrompt and does not submit", () => {
    expect(planDraftInjection("run me", "edit me", identity)).toEqual({ text: "edit me", autoSubmit: false });
  });

  // `??` keeps an empty-string draft, so it still shadows the initialPrompt and yields a no-op —
  // the initialPrompt does not "show through" a blank draft.
  it("treats an empty-string draft as a no-op that shadows the initialPrompt", () => {
    expect(planDraftInjection("run me", "", identity)).toBeNull();
  });

  it("is a no-op for an empty-string initialPrompt", () => {
    expect(planDraftInjection("", undefined, identity)).toBeNull();
  });

  // Sanitizing to empty (e.g. text that was all control bytes) collapses to a no-op.
  it("is a no-op when the text sanitizes to empty", () => {
    expect(planDraftInjection("\x1b\x03", undefined, () => "")).toBeNull();
  });

  // The sanitized text is what lands in the plan, not the raw input.
  it("carries the sanitized text, not the raw input", () => {
    expect(planDraftInjection("  keep  ", undefined, (s) => s.trim())).toEqual({ text: "keep", autoSubmit: true });
  });
});
