// @vitest-environment node
//
// The live counterpart of the transcript's work-phase read. The rule it has to match is the turn
// boundary: a fresh user prompt resets, tool results do not — so an Edit early in a turn keeps the
// turn reading as "implementing" through every verification read that follows it.
import { describe, it, expect } from "vitest";

import { createWorkPhaseTracker, nextTurnTools } from "../../../server/session/work-phase-tracker.js";

const S = "session-1";

describe("nextTurnTools", () => {
  it("starts a new turn on a user prompt, dropping the previous turn's tools", () => {
    expect(nextTurnTools(["Edit", "Read"], "UserPromptSubmit")).toEqual([]);
  });

  it("appends the tool a PreToolUse names", () => {
    expect(nextTurnTools(["Read"], "PreToolUse", "Edit")).toEqual(["Read", "Edit"]);
  });

  it("ignores hooks that are not a turn start or a tool start", () => {
    expect(nextTurnTools(["Read"], "PostToolUse", "Edit")).toEqual(["Read"]);
    expect(nextTurnTools(["Read"], "Stop")).toEqual(["Read"]);
    expect(nextTurnTools(["Read"], "Notification")).toEqual(["Read"]);
  });

  it("ignores a PreToolUse with no tool name", () => {
    expect(nextTurnTools(["Read"], "PreToolUse")).toEqual(["Read"]);
  });

  it("does not mutate the array it is given", () => {
    const prev = ["Read"];
    nextTurnTools(prev, "PreToolUse", "Edit");
    expect(prev).toEqual(["Read"]);
  });

  // A single turn can run a very long tool chain; the classifier only asks "was there a mutation",
  // so the window is capped rather than grown without bound.
  it("caps one turn's tools, keeping the most recent", () => {
    const many = Array.from({ length: 200 }, (_, i) => `T${i}`);
    const next = nextTurnTools(many, "PreToolUse", "Edit");
    expect(next).toHaveLength(200);
    expect(next[199]).toBe("Edit");
    expect(next[0]).toBe("T1"); // the oldest fell off
  });
});

describe("createWorkPhaseTracker", () => {
  it("reports null before anything has been observed", () => {
    expect(createWorkPhaseTracker().phaseOf(S)).toBeNull();
  });

  it("reads a turn that has only searched/read as planning", () => {
    const t = createWorkPhaseTracker();
    t.note(S, "UserPromptSubmit");
    t.note(S, "PreToolUse", "Read");
    t.note(S, "PreToolUse", "Grep");
    expect(t.phaseOf(S)).toBe("planning");
  });

  it("reads a turn that has changed the workspace as implementing", () => {
    const t = createWorkPhaseTracker();
    t.note(S, "UserPromptSubmit");
    t.note(S, "PreToolUse", "Read");
    t.note(S, "PreToolUse", "Edit");
    expect(t.phaseOf(S)).toBe("implementing");
  });

  // The stability rule: verification reads AFTER an edit must not demote the turn to planning.
  it("stays implementing through the reads that follow an edit", () => {
    const t = createWorkPhaseTracker();
    t.note(S, "UserPromptSubmit");
    t.note(S, "PreToolUse", "Edit");
    t.note(S, "PreToolUse", "Read");
    t.note(S, "PreToolUse", "Bash");
    expect(t.phaseOf(S)).toBe("implementing");
  });

  // The leak the turn boundary exists to prevent: last turn's Edit must not colour a new turn
  // that is only reading.
  it("forgets the previous turn's edit when a new prompt arrives", () => {
    const t = createWorkPhaseTracker();
    t.note(S, "UserPromptSubmit");
    t.note(S, "PreToolUse", "Edit");
    t.note(S, "UserPromptSubmit");
    expect(t.phaseOf(S)).toBeNull(); // no tools yet in the new turn
    t.note(S, "PreToolUse", "Read");
    expect(t.phaseOf(S)).toBe("planning");
  });

  it("tracks each session independently", () => {
    const t = createWorkPhaseTracker();
    t.note("a", "PreToolUse", "Edit");
    t.note("b", "PreToolUse", "Read");
    expect([t.phaseOf("a"), t.phaseOf("b")]).toEqual(["implementing", "planning"]);
  });

  it("drops a session's turn on forget, so a reused id starts clean", () => {
    const t = createWorkPhaseTracker();
    t.note(S, "PreToolUse", "Edit");
    t.forget(S);
    expect(t.phaseOf(S)).toBeNull();
  });
});
