import { describe, it, expect } from "vitest";
import { nextActivity, sessionRow, shouldRefreshReply } from "../../../server/session/activity-transition.js";

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

// The row every subscribed client renders from. Defaults are applied here so a session
// with no activity yet reads as idle rather than arriving with holes the UI must guess at.
describe("sessionRow", () => {
  it("fills every field for a session with no activity yet", () => {
    expect(sessionRow("S", undefined, null, {})).toEqual({
      id: "S",
      cwd: null,
      working: false,
      waiting: false,
      event: null,
      lastPrompt: null,
      aiTitle: null,
      lastResponse: null,
    });
  });

  it("carries the activity flags and label through", () => {
    const row = sessionRow("S", { working: true, waiting: true, event: "Stop", at: 1 }, "/ws", {});
    expect(row).toMatchObject({ working: true, waiting: true, event: "Stop", cwd: "/ws" });
  });

  it("does not leak `at` — it is bookkeeping, not part of the row", () => {
    expect(Object.keys(sessionRow("S", { working: true, at: 999 }, null, {}))).not.toContain("at");
  });

  it("carries the roster texts, defaulting each missing one to null", () => {
    expect(sessionRow("S", undefined, null, { lastPrompt: "p", lastResponse: "r" })).toMatchObject({
      lastPrompt: "p",
      aiTitle: null,
      lastResponse: "r",
    });
  });

  it("keeps an empty text as empty rather than turning it into null", () => {
    // `/clear` blanks the prompt deliberately: "" beats the transcript fallback the
    // reader applies, while null would let the pre-clear prompt resurface.
    expect(sessionRow("S", undefined, null, { lastPrompt: "", lastResponse: "" })).toMatchObject({
      lastPrompt: "",
      lastResponse: "",
    });
  });

  it("keeps a null cwd, which is what a reaped session has", () => {
    expect(sessionRow("S", { working: true }, null, {}).cwd).toBeNull();
  });
});

describe("shouldRefreshReply", () => {
  it("refreshes when a turn just ended and there is a transcript to read", () => {
    expect(shouldRefreshReply({ waiting: true }, "/ws")).toBe(true);
  });

  it("does not refresh a session that is not waiting", () => {
    // Re-reading on every publish would put a file read in the path of each hook.
    expect(shouldRefreshReply({ working: true }, "/ws")).toBe(false);
    expect(shouldRefreshReply({ waiting: false }, "/ws")).toBe(false);
    expect(shouldRefreshReply({}, "/ws")).toBe(false);
    expect(shouldRefreshReply(undefined, "/ws")).toBe(false);
  });

  it("does not refresh without a cwd — there is no transcript to read", () => {
    expect(shouldRefreshReply({ waiting: true }, null)).toBe(false);
    expect(shouldRefreshReply({ waiting: true }, "")).toBe(false);
  });
});
