import { describe, expect, it } from "vitest";
import { codexActivityRolloutId } from "../../../server/session/spawn-codex.js";

describe("codexActivityRolloutId", () => {
  it("prefers an explicit resume id", () => {
    expect(codexActivityRolloutId("resume", true, "mapped")).toBe("resume");
  });
  it("uses the persisted mapping for a surviving tmux reattach", () => {
    expect(codexActivityRolloutId(null, true, "mapped")).toBe("mapped");
  });
  it("does not use a mapping for a fresh session", () => {
    expect(codexActivityRolloutId(null, false, "mapped")).toBeNull();
  });
});
