// A view-only frame moves exactly the field it carries, and a finale is counted rather than
// flagged, so the view reacts to each one even when two arrive at the same level.
import { describe, it, expect } from "vitest";
import { applySessionExit, applySessionOutput, applyViewFrame, type ConnViewState } from "../../../src/composables/connViewFrames";

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

// The mark a kept cell reads to refuse a talk from a dead session (#3276, #3280).
const exitFrame = (ended?: boolean) => ({ type: "exit", exitCode: 137, ...(ended === undefined ? {} : { ended }) });

describe("the session-ended mark", () => {
  it("is set by an exit the server says ended the session", () => {
    const v = view();
    applySessionExit(v, exitFrame(true));
    expect(v).toEqual({ ...view(), sessionEnded: true });
  });

  // A start that failed after the session was announced carries no `ended` field.
  it.each([{ type: "error", message: "failed to start" }, { type: "error" }])("is set by an error frame (%j)", (frame) => {
    const v = view();
    applySessionExit(v, frame);
    expect(v.sessionEnded).toBe(true);
  });

  // A lost client leaves the agent running; a frame without the field never ends anything.
  it.each([exitFrame(false), exitFrame(), { type: "superseded" }, {}])("is not set by %j", (frame) => {
    const v = view();
    applySessionExit(v, frame);
    expect(v.sessionEnded).toBe(false);
  });

  it("is not cleared by a later exit that only lost the client", () => {
    const v = { ...view(), sessionEnded: true };
    applySessionExit(v, exitFrame(false));
    expect(v.sessionEnded).toBe(true);
  });

  it("is cleared by output, which only a running process sends", () => {
    const v = { ...view(), sessionEnded: true };
    applySessionOutput(v);
    expect(v).toEqual(view());
  });

  it("leaves an unmarked view as it was on output", () => {
    const v = view();
    applySessionOutput(v);
    expect(v).toEqual(view());
  });

  it("does nothing for a view that is gone", () => {
    expect(() => applySessionExit(undefined, exitFrame(true))).not.toThrow();
    expect(() => applySessionOutput(undefined)).not.toThrow();
  });
});
