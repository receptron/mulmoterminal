import { describe, it, expect } from "vitest";
import { nextActivity } from "../../../server/session/activity-transition.js";

const NOW = 1_700_000_000_000;

describe("nextActivity", () => {
  describe("no-op detection", () => {
    it("reports no change when the flag already holds that value", () => {
      // Every hook calls a setter; without this an idle session would republish its row
      // on each one, waking every subscribed client for nothing.
      expect(nextActivity({ working: true }, { working: true }, undefined, NOW)).toBeNull();
      expect(nextActivity({ waiting: false }, { waiting: false }, undefined, NOW)).toBeNull();
    });

    it("treats an absent flag as false, so clearing an unset one is a no-op", () => {
      expect(nextActivity({}, { working: false }, undefined, NOW)).toBeNull();
      expect(nextActivity(undefined, { waiting: false }, undefined, NOW)).toBeNull();
      expect(nextActivity({ waiting: true }, { working: false }, undefined, NOW)).toBeNull();
    });

    it("reports a change even when only the event would differ", () => {
      // The flag is what decides; an event alone must not trigger a write.
      expect(nextActivity({ working: true, event: "A" }, { working: true }, "B", NOW)).toBeNull();
    });
  });

  describe("setting a flag", () => {
    it("records the new value and the time", () => {
      expect(nextActivity(undefined, { working: true }, "UserPromptSubmit", NOW)).toEqual({
        working: true,
        event: "UserPromptSubmit",
        at: NOW,
      });
    });

    it("keeps the other flag untouched", () => {
      expect(nextActivity({ working: true, waiting: true, event: "Stop", at: 1 }, { working: false }, undefined, NOW)).toEqual({
        working: false,
        waiting: true,
        event: "Stop",
        at: NOW,
      });
    });

    it("clears a set flag", () => {
      expect(nextActivity({ waiting: true, event: "Notification", at: 1 }, { waiting: false }, undefined, NOW)).toEqual({
        waiting: false,
        event: "Notification",
        at: NOW,
      });
    });

    it("always advances `at`, so the record reflects this change", () => {
      expect(nextActivity({ working: false, at: 1 }, { working: true }, undefined, NOW)?.at).toBe(NOW);
    });
  });

  describe("event label", () => {
    it("takes the event it was given", () => {
      expect(nextActivity({ event: "Stop" }, { working: true }, "UserPromptSubmit", NOW)?.event).toBe("UserPromptSubmit");
    });

    it("keeps the previous event when none is given", () => {
      // A change carrying no event must not blank a row that was labelled "Notification" —
      // the label is what the UI shows for why the session wants attention.
      expect(nextActivity({ waiting: true, event: "Notification" }, { working: true }, undefined, NOW)?.event).toBe("Notification");
    });

    it("is null when neither the change nor the previous record has one", () => {
      expect(nextActivity(undefined, { working: true }, undefined, NOW)?.event).toBeNull();
      expect(nextActivity({ event: null }, { working: true }, undefined, NOW)?.event).toBeNull();
    });

    it("prefers an explicit empty event over the previous one", () => {
      // "" is a given value, not an absent one — `??` only falls through on null/undefined.
      expect(nextActivity({ event: "Stop" }, { working: true }, "", NOW)?.event).toBe("");
    });
  });

  it("does not mutate the record it was given", () => {
    const prev = { working: false, event: "Stop", at: 1 };
    nextActivity(prev, { working: true }, "UserPromptSubmit", NOW);
    expect(prev).toEqual({ working: false, event: "Stop", at: 1 });
  });

  it("drives both setters identically apart from which flag moves", () => {
    const prev = { event: "Stop", at: 1 };
    expect(nextActivity(prev, { working: true }, undefined, NOW)).toEqual({ working: true, event: "Stop", at: NOW });
    expect(nextActivity(prev, { waiting: true }, undefined, NOW)).toEqual({ waiting: true, event: "Stop", at: NOW });
  });
});
