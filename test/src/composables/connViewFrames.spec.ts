// A view-only frame moves exactly the field it carries, and a finale is counted rather than
// flagged, so the view reacts to each one even when two arrive at the same level.
import { describe, it, expect } from "vitest";
import { applySessionExit, applySessionStart, applyViewFrame, type ConnViewState } from "../../../src/composables/connViewFrames";

const view = (): ConnViewState => ({ status: "connected", serverCwd: "/w", inCopyMode: false, heatLevel: 0, heatFinales: 0, sessionEnded: false });

describe("applyViewFrame", () => {
  it("sets the copy-mode flag from a paneMode frame and nothing else", () => {
    const v = view();
    applyViewFrame(v, { type: "paneMode", inCopyMode: true });
    expect(v).toEqual({ ...view(), inCopyMode: true });
  });

  it("sets the heat level from a heat frame and nothing else", () => {
    const v = view();
    applyViewFrame(v, { type: "heat", level: 3, finale: false });
    expect(v).toEqual({ ...view(), heatLevel: 3 });
  });

  it("counts each finale", () => {
    const v = view();
    applyViewFrame(v, { type: "heat", level: 0, finale: true });
    applyViewFrame(v, { type: "heat", level: 0, finale: true });
    expect(v.heatFinales).toBe(2);
  });

  it("ignores a malformed frame", () => {
    const v = view();
    applyViewFrame(v, { type: "heat", level: 9, finale: false });
    applyViewFrame(v, { type: "paneMode", inCopyMode: "yes" });
    expect(v).toEqual(view());
  });

  it("does nothing for a view that is gone", () => {
    expect(() => applyViewFrame(undefined, { type: "heat", level: 1, finale: false })).not.toThrow();
  });
});

// The mark a kept cell reads to refuse a talk from a dead session (#3276).
describe("the session-ended mark", () => {
  it("is set by an exit the server says ended the session", () => {
    const v = view();
    applySessionExit(v, true);
    expect(v).toEqual({ ...view(), sessionEnded: true });
  });

  // A lost client leaves the agent running.
  it("is not set by an exit that only lost the client", () => {
    const v = view();
    applySessionExit(v, false);
    expect(v.sessionEnded).toBe(false);
  });

  it("is not cleared by a later exit that only lost the client", () => {
    const v = { ...view(), sessionEnded: true };
    applySessionExit(v, false);
    expect(v.sessionEnded).toBe(true);
  });

  it("is cleared by the server's session frame", () => {
    const v = { ...view(), sessionEnded: true };
    applySessionStart(v);
    expect(v).toEqual(view());
  });

  it("does nothing for a view that is gone", () => {
    expect(() => applySessionExit(undefined, true)).not.toThrow();
    expect(() => applySessionStart(undefined)).not.toThrow();
  });
});
