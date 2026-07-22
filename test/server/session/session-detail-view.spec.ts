// @vitest-environment node
import { describe, it, expect } from "vitest";

import { sessionDetailView } from "../../../server/session/session-detail-view.js";

const TRANSCRIPT = { lastPrompt: "the old task", lastResponse: "the old reply" };
const NO_ACTIVITY = {};

describe("sessionDetailView", () => {
  it("prefers what this process saw over the transcript", () => {
    const view = sessionDetailView({ lastPrompt: "live task", lastResponse: "live reply" }, TRANSCRIPT, NO_ACTIVITY);
    expect([view.lastPrompt, view.lastResponse]).toEqual(["live task", "live reply"]);
  });

  it("falls back to the transcript for a session this process never saw", () => {
    const view = sessionDetailView({}, TRANSCRIPT, NO_ACTIVITY);
    expect([view.lastPrompt, view.lastResponse]).toEqual(["the old task", "the old reply"]);
  });

  // THE contract. `/clear` writes "" into the live maps precisely so it outranks the
  // transcript; `||` would let the abandoned task and its reply come straight back, and it
  // would read as plausible output rather than as a bug.
  it("lets a cleared session stay cleared, rather than resurrecting the transcript", () => {
    const view = sessionDetailView({ lastPrompt: "", lastResponse: "" }, TRANSCRIPT, NO_ACTIVITY);
    expect([view.lastPrompt, view.lastResponse]).toEqual(["", ""]);
  });

  it("clears the prompt and the reply independently", () => {
    const view = sessionDetailView({ lastPrompt: "" }, TRANSCRIPT, NO_ACTIVITY);
    expect([view.lastPrompt, view.lastResponse]).toEqual(["", "the old reply"]);
  });

  it("reports nothing when neither side has anything", () => {
    const view = sessionDetailView({}, { lastPrompt: null, lastResponse: null }, NO_ACTIVITY);
    expect([view.lastPrompt, view.lastResponse]).toEqual([null, null]);
  });

  // Ours only — never the external on-disk ai-title, which is MulmoClaude's.
  it("reports our own title, or none", () => {
    expect(sessionDetailView({ aiTitle: "Fix the login bug" }, TRANSCRIPT, NO_ACTIVITY).aiTitle).toBe("Fix the login bug");
    expect(sessionDetailView({}, TRANSCRIPT, NO_ACTIVITY).aiTitle).toBeNull();
  });

  // A cleared title is "" in the map only briefly; either way it must not become the
  // transcript's.
  it("does not substitute anything for an empty title", () => {
    expect(sessionDetailView({ aiTitle: "" }, TRANSCRIPT, NO_ACTIVITY).aiTitle).toBe("");
  });

  describe("activity", () => {
    it("passes the flags through", () => {
      const view = sessionDetailView({}, TRANSCRIPT, { working: true, waiting: false, event: "Stop" });
      expect([view.working, view.waiting, view.event]).toEqual([true, false, "Stop"]);
    });

    // An absent record is an idle session, not an unknown one: the cockpit renders a dot
    // either way, and "unknown" has no dot to render.
    it("treats an absent record as idle", () => {
      const view = sessionDetailView({}, TRANSCRIPT, {});
      expect([view.working, view.waiting, view.event]).toEqual([false, false, null]);
    });

    it("keeps a session that is waiting distinct from one that is merely not working", () => {
      expect(sessionDetailView({}, TRANSCRIPT, { waiting: true }).waiting).toBe(true);
      expect(sessionDetailView({}, TRANSCRIPT, { working: false }).waiting).toBe(false);
    });
  });
});
