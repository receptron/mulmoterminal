// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import { runWithHiddenMarker } from "../../../server/session/hiddenMarker.js";

describe("runWithHiddenMarker", () => {
  it("marks the session hidden and keeps the marker when the spawn succeeds", () => {
    const set = new Set<string>();
    const result = runWithHiddenMarker(true, "s1", set, () => "spawned");
    expect(result).toBe("spawned");
    expect(set.has("s1")).toBe(true);
  });

  it("removes the marker again when the spawn throws, and re-throws", () => {
    const set = new Set<string>();
    const boom = new Error("spawn failed");
    expect(() =>
      runWithHiddenMarker(true, "s2", set, () => {
        expect(set.has("s2")).toBe(true); // added before the spawn runs (a mid-spawn hook must see it)
        throw boom;
      }),
    ).toThrow(boom);
    expect(set.has("s2")).toBe(false); // no phantom hidden id left behind
  });

  it("never touches the set when the session isn't hidden (success)", () => {
    const set = { add: vi.fn(), delete: vi.fn() };
    expect(runWithHiddenMarker(false, "s3", set, () => 42)).toBe(42);
    expect(set.add).not.toHaveBeenCalled();
    expect(set.delete).not.toHaveBeenCalled();
  });

  it("never touches the set when the session isn't hidden (throw)", () => {
    const set = { add: vi.fn(), delete: vi.fn() };
    expect(() =>
      runWithHiddenMarker(false, "s4", set, () => {
        throw new Error("x");
      }),
    ).toThrow("x");
    expect(set.add).not.toHaveBeenCalled();
    expect(set.delete).not.toHaveBeenCalled();
  });
});
