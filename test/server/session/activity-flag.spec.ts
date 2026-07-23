// @vitest-environment node
import { describe, it, expect } from "vitest";

import { flagEffect } from "../../../server/session/activity-flag.js";
import type { Activity } from "../../../server/session/types.js";

const NOW = 1_000;
const at = (over: Partial<Activity> = {}): Activity => ({ working: false, waiting: false, event: null, at: 0, ...over });

describe("flagEffect", () => {
  it("carries the new working flag through", () => {
    const e = flagEffect(undefined, "working", true, "UserPromptSubmit", NOW);
    expect(e.next?.working).toBe(true);
  });

  // Every hook calls the setters, so an unchanged value must produce no effect — otherwise
  // the socket floods with identical rows.
  it("is a no-op when the flag did not actually move", () => {
    expect(flagEffect(at({ working: true }), "working", true, "UserPromptSubmit", NOW)).toEqual({ next: null, rearmReap: false });
    expect(flagEffect(at({ waiting: true }), "waiting", true, "Notification", NOW)).toEqual({ next: null, rearmReap: false });
  });

  // The difference the duplication was hiding: working re-arms the reap when it goes FALSE
  // (a finished turn may be waiting on the user), waiting re-arms when it goes TRUE.
  it("re-arms the reap when working goes false, not when it goes true", () => {
    expect(flagEffect(at(), "working", true, "UserPromptSubmit", NOW).rearmReap).toBe(false);
    expect(flagEffect(at({ working: true }), "working", false, "Stop", NOW).rearmReap).toBe(true);
  });

  it("re-arms the reap when waiting goes true, not when it goes false", () => {
    expect(flagEffect(at(), "waiting", true, "Notification", NOW).rearmReap).toBe(true);
    expect(flagEffect(at({ waiting: true }), "waiting", false, undefined, NOW).rearmReap).toBe(false);
  });

  // A no-op never re-arms — the two must not disagree.
  it("does not re-arm on a no-op even on the re-arming edge", () => {
    // waiting already true, set true again → no change → must not re-arm
    expect(flagEffect(at({ waiting: true }), "waiting", true, "Notification", NOW).rearmReap).toBe(false);
  });

  it("touches only the flag it is given", () => {
    const e = flagEffect(at({ waiting: true, event: "Notification" }), "working", true, "UserPromptSubmit", NOW);
    expect(e.next?.waiting).toBe(true);
  });
});
