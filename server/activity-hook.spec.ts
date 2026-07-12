import { describe, it, expect } from "vitest";
import { activityHookEffects } from "./activity-hook.js";

describe("activityHookEffects", () => {
  it("UserPromptSubmit sets working regardless of active", () => {
    expect(activityHookEffects("UserPromptSubmit", true)).toEqual([{ kind: "working", value: true }]);
    expect(activityHookEffects("UserPromptSubmit", false)).toEqual([{ kind: "working", value: true }]);
  });

  it("Stop on the actively-viewed pane clears working only (no attention flag)", () => {
    expect(activityHookEffects("Stop", true)).toEqual([{ kind: "working", value: false }]);
  });

  it("Stop on an inactive pane (e.g. an unfocused grid cell) flags done, then clears working", () => {
    // Regression for #321 #5-symptom: a finished on-screen grid cell was stuck idle
    // because it counted as foreground. Order matters: waiting before working.
    expect(activityHookEffects("Stop", false)).toEqual([
      { kind: "waiting", value: true },
      { kind: "working", value: false },
    ]);
  });

  it("Notification on the actively-viewed pane does nothing", () => {
    expect(activityHookEffects("Notification", true)).toEqual([]);
  });

  it("Notification on an inactive pane flags blocked", () => {
    // Regression for #321 #1: an on-screen grid cell blocked on a permission prompt
    // showed 'Working…' instead of amber because it counted as foreground.
    expect(activityHookEffects("Notification", false)).toEqual([{ kind: "waiting", value: true }]);
  });

  it("ignores unrelated events", () => {
    expect(activityHookEffects("PreToolUse", false)).toEqual([]);
    expect(activityHookEffects("SessionStart", true)).toEqual([]);
  });
});
