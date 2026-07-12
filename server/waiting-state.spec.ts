import { describe, it, expect } from "vitest";
import { buildWaitingSnapshot, parseWaitingState } from "./waiting-state.js";

const never = () => false;
const anyId = () => true;

describe("buildWaitingSnapshot", () => {
  it("keeps only waiting sessions, mapping id -> event", () => {
    const entries: Array<[string, { waiting?: boolean; event?: string | null }]> = [
      ["a", { waiting: true, event: "Notification" }],
      ["b", { waiting: true, event: "Stop" }],
      ["c", { waiting: false, event: "UserPromptSubmit" }],
    ];
    expect(buildWaitingSnapshot(entries, never)).toEqual({ a: "Notification", b: "Stop" });
  });

  it("excludes hidden sessions (translation workers)", () => {
    const entries: Array<[string, { waiting?: boolean; event?: string | null }]> = [
      ["a", { waiting: true, event: "Notification" }],
      ["hidden", { waiting: true, event: "Stop" }],
    ];
    expect(buildWaitingSnapshot(entries, (id) => id === "hidden")).toEqual({ a: "Notification" });
  });

  it("defaults a missing event to null", () => {
    expect(buildWaitingSnapshot([["a", { waiting: true }]], never)).toEqual({ a: null });
  });
});

describe("parseWaitingState", () => {
  it("parses id/event pairs", () => {
    expect(parseWaitingState({ a: "Notification", b: "Stop" }, anyId)).toEqual([
      { id: "a", event: "Notification" },
      { id: "b", event: "Stop" },
    ]);
  });

  it("drops ids that fail validation", () => {
    expect(parseWaitingState({ good: "Stop", "../bad": "Notification" }, (id) => id === "good")).toEqual([{ id: "good", event: "Stop" }]);
  });

  it("coerces a non-string event to null", () => {
    expect(parseWaitingState({ a: 5 }, anyId)).toEqual([{ id: "a", event: null }]);
  });

  it("returns [] for non-object input", () => {
    expect(parseWaitingState(null, anyId)).toEqual([]);
    expect(parseWaitingState("x", anyId)).toEqual([]);
  });
});
