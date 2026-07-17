import { describe, it, expect } from "vitest";
import { buildActivitySnapshot, parseActivityState, type RestartActivity } from "../../../server/session/activity-state";

const never = () => false;
const anyId = () => true;

describe("buildActivitySnapshot", () => {
  it("keeps working OR waiting sessions with their full state, dropping idle ones", () => {
    const entries: Array<[string, RestartActivity]> = [
      ["a", { waiting: true, event: "Notification" }],
      ["b", { working: true, event: "UserPromptSubmit" }],
      ["c", { working: false, waiting: false, event: null }],
    ];
    expect(buildActivitySnapshot(entries, never)).toEqual({
      a: { working: false, waiting: true, event: "Notification" },
      b: { working: true, waiting: false, event: "UserPromptSubmit" },
    });
  });

  it("excludes hidden sessions (translation workers)", () => {
    const entries: Array<[string, RestartActivity]> = [
      ["a", { waiting: true, event: "Stop" }],
      ["hidden", { working: true, event: "x" }],
    ];
    expect(buildActivitySnapshot(entries, (id) => id === "hidden")).toEqual({ a: { working: false, waiting: true, event: "Stop" } });
  });

  it("defaults a missing event to null", () => {
    expect(buildActivitySnapshot([["a", { waiting: true }]], never)).toEqual({ a: { working: false, waiting: true, event: null } });
  });
});

describe("parseActivityState", () => {
  it("parses id -> {working, waiting, event}", () => {
    const raw = { a: { working: false, waiting: true, event: "Stop" }, b: { working: true, waiting: false, event: null } };
    expect(parseActivityState(raw, anyId)).toEqual([
      { id: "a", working: false, waiting: true, event: "Stop" },
      { id: "b", working: true, waiting: false, event: null },
    ]);
  });

  it("drops ids that fail validation and non-object entries", () => {
    const raw = { good: { waiting: true, event: "Stop" }, "../bad": { waiting: true }, x: "nope" };
    expect(parseActivityState(raw, (id) => id === "good")).toEqual([{ id: "good", working: false, waiting: true, event: "Stop" }]);
  });

  it("coerces missing/invalid fields to false/null", () => {
    expect(parseActivityState({ a: { event: 5 } }, anyId)).toEqual([{ id: "a", working: false, waiting: false, event: null }]);
  });

  it("returns [] for non-object input", () => {
    expect(parseActivityState(null, anyId)).toEqual([]);
    expect(parseActivityState("x", anyId)).toEqual([]);
  });
});
