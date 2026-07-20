import { describe, it, expect } from "vitest";
import { activityHookEffects, resolveHookSessionId, shouldNotifyTaskFinished } from "../../../server/session/activity-hook.js";

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

describe("shouldNotifyTaskFinished", () => {
  it("fires on every finished turn — unlike the beep, the actively-viewed pane is NOT exempt", () => {
    // The push takes no `active` argument by design: a Stop notifies whether or not the user
    // is looking at that pane. This regression-guards against re-adding an active-pane gate.
    expect(shouldNotifyTaskFinished("Stop")).toBe(true);
  });

  it("does not fire on non-Stop events (a paused turn / prompt / tool use is not a finish)", () => {
    expect(shouldNotifyTaskFinished("Notification")).toBe(false);
    expect(shouldNotifyTaskFinished("UserPromptSubmit")).toBe(false);
    expect(shouldNotifyTaskFinished("PreToolUse")).toBe(false);
    expect(shouldNotifyTaskFinished("SessionStart")).toBe(false);
  });
});

describe("resolveHookSessionId", () => {
  const UUID = "8b1f2c4e-0000-4aaa-9bbb-ccddeeff0011";
  const OTHER = "11111111-2222-4333-8444-555555555555";
  const isValidId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const resolve = (header: unknown, body: unknown) => resolveHookSessionId(header, body, isValidId);

  // Claude reissues its own session_id on /clear and /compact; the mulmoterminal id is
  // the one hooks must stay attributed to.
  it("prefers the mulmoterminal header over Claude's own id", () => {
    expect(resolve(UUID, OTHER)).toBe(UUID);
  });

  it("falls back to the body when no header is present", () => {
    expect(resolve(undefined, UUID)).toBe(UUID);
  });

  // The fallback used to skip the shape check the header path applied.
  it("validates the body fallback, not just the header", () => {
    expect(resolve(undefined, "not-a-uuid")).toBeNull();
    expect(resolve(undefined, "")).toBeNull();
  });

  it("falls through to the body when the header is malformed", () => {
    expect(resolve("garbage", UUID)).toBe(UUID);
  });

  // The id becomes a Firestore document id. A value with a path separator would change
  // the document's depth rather than address a session.
  it("rejects an id carrying a path separator", () => {
    expect(resolve(undefined, `${UUID}/../../other`)).toBeNull();
    expect(resolve(undefined, "a/b")).toBeNull();
  });

  it("rejects non-string sources", () => {
    for (const value of [42, true, null, undefined, { id: UUID }, [UUID]]) {
      expect(resolve(value, value)).toBeNull();
    }
  });

  it("accepts either case, since the shape check is case-insensitive", () => {
    expect(resolve(undefined, UUID.toUpperCase())).toBe(UUID.toUpperCase());
  });
});
