// @vitest-environment node
import { describe, it, expect } from "vitest";

import { sessionDetailView } from "../../../server/session/session-detail-view.js";

const TRANSCRIPT = { lastPrompt: "the old task", lastResponse: "the old reply" };
const NO_ACTIVITY = {};
const NOT_CLEARED = false;

describe("sessionDetailView", () => {
  it("prefers what this process saw over the transcript", () => {
    const view = sessionDetailView({ lastPrompt: "live task", lastResponse: "live reply" }, TRANSCRIPT, NO_ACTIVITY, NOT_CLEARED);
    expect([view.lastPrompt, view.lastResponse]).toEqual(["live task", "live reply"]);
  });

  it("falls back to the transcript for a session this process never saw", () => {
    const view = sessionDetailView({}, TRANSCRIPT, NO_ACTIVITY, NOT_CLEARED);
    expect([view.lastPrompt, view.lastResponse]).toEqual(["the old task", "the old reply"]);
  });

  // THE contract. `/clear` writes "" into the live maps precisely so it outranks the
  // transcript; `||` would let the abandoned task and its reply come straight back, and it
  // would read as plausible output rather than as a bug.
  it("lets a cleared session stay cleared, rather than resurrecting the transcript", () => {
    const view = sessionDetailView({ lastPrompt: "", lastResponse: "" }, TRANSCRIPT, NO_ACTIVITY, NOT_CLEARED);
    expect([view.lastPrompt, view.lastResponse]).toEqual(["", ""]);
  });

  it("clears the prompt and the reply independently", () => {
    const view = sessionDetailView({ lastPrompt: "" }, TRANSCRIPT, NO_ACTIVITY, NOT_CLEARED);
    expect([view.lastPrompt, view.lastResponse]).toEqual(["", "the old reply"]);
  });

  it("reports nothing when neither side has anything", () => {
    const view = sessionDetailView({}, { lastPrompt: null, lastResponse: null }, NO_ACTIVITY, NOT_CLEARED);
    expect([view.lastPrompt, view.lastResponse]).toEqual([null, null]);
  });

  // The sentinel's blind spot: a restart empties the live maps while the transcript stays frozen
  // exactly as the clear left it, so without the (persisted) mark the fallback hands the ended
  // conversation back on the first fetch after the restart (#1085).
  it("keeps a cleared session cleared even once this process has forgotten it", () => {
    const view = sessionDetailView({}, TRANSCRIPT, NO_ACTIVITY, true);
    // "" and not null: an empty string survives the roster's merge and blanks the row, where
    // null reads as "no news" and leaves the pre-clear text on screen.
    expect([view.lastPrompt, view.lastResponse]).toEqual(["", ""]);
  });

  // The live value is this process watching the NEW conversation, so it still outranks the mark.
  it("still prefers what it has seen since the clear", () => {
    const view = sessionDetailView({ lastPrompt: "the new task" }, TRANSCRIPT, NO_ACTIVITY, true);
    expect([view.lastPrompt, view.lastResponse]).toEqual(["the new task", ""]);
  });

  // The memo is the user's own note about the CELL, not something read off the transcript, so a
  // clear has no business dropping it (#1084 + #1085).
  it("keeps the memo across a clear", () => {
    expect(sessionDetailView({ memo: "#1077 の検証" }, TRANSCRIPT, NO_ACTIVITY, true).memo).toBe("#1077 の検証");
  });

  // Ours only — never the external on-disk ai-title, which is MulmoClaude's.
  it("reports our own title, or none", () => {
    expect(sessionDetailView({ aiTitle: "Fix the login bug" }, TRANSCRIPT, NO_ACTIVITY, NOT_CLEARED).aiTitle).toBe("Fix the login bug");
    expect(sessionDetailView({}, TRANSCRIPT, NO_ACTIVITY, NOT_CLEARED).aiTitle).toBeNull();
  });

  // A cleared title is "" in the map only briefly; either way it must not become the
  // transcript's.
  it("does not substitute anything for an empty title", () => {
    expect(sessionDetailView({ aiTitle: "" }, TRANSCRIPT, NO_ACTIVITY, NOT_CLEARED).aiTitle).toBe("");
  });

  // The seed a grid cell renders its header from before any push arrives (#1084). Absent is the
  // ordinary case — an erased memo is deleted from the store, not kept as "".
  it("reports the session's memo, or none", () => {
    expect(sessionDetailView({ memo: "#1077 の検証" }, TRANSCRIPT, NO_ACTIVITY, NOT_CLEARED).memo).toBe("#1077 の検証");
    expect(sessionDetailView({}, TRANSCRIPT, NO_ACTIVITY, NOT_CLEARED).memo).toBeNull();
  });

  describe("activity", () => {
    it("passes the flags through", () => {
      const view = sessionDetailView({}, TRANSCRIPT, { working: true, waiting: false, event: "Stop" }, NOT_CLEARED);
      expect([view.working, view.waiting, view.event]).toEqual([true, false, "Stop"]);
    });

    // An absent record is an idle session, not an unknown one: the cockpit renders a dot
    // either way, and "unknown" has no dot to render.
    it("treats an absent record as idle", () => {
      const view = sessionDetailView({}, TRANSCRIPT, {}, NOT_CLEARED);
      expect([view.working, view.waiting, view.event]).toEqual([false, false, null]);
    });

    it("keeps a session that is waiting distinct from one that is merely not working", () => {
      expect(sessionDetailView({}, TRANSCRIPT, { waiting: true }, NOT_CLEARED).waiting).toBe(true);
      expect(sessionDetailView({}, TRANSCRIPT, { working: false }, NOT_CLEARED).waiting).toBe(false);
    });
  });
});
