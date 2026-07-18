// @vitest-environment node
import { describe, it, expect } from "vitest";
import { classifyWorkPhase } from "../../../server/session/workPhase.js";

describe("classifyWorkPhase", () => {
  it("returns null when there are no tools to judge", () => {
    expect(classifyWorkPhase([])).toBeNull();
  });

  it.each([["Edit"], ["MultiEdit"], ["Write"], ["NotebookEdit"]])("classifies %s as implementing", (tool) => {
    expect(classifyWorkPhase([tool])).toBe("implementing");
  });

  it.each([["Read"], ["Grep"], ["Glob"], ["WebFetch"], ["WebSearch"], ["Task"], ["TodoWrite"]])("classifies read/explore %s as planning", (tool) => {
    expect(classifyWorkPhase([tool])).toBe("planning");
  });

  it("classifies a read-then-edit window as implementing (a mutation anywhere wins)", () => {
    expect(classifyWorkPhase(["Read", "Grep", "Edit"])).toBe("implementing");
  });

  it("classifies an explore-only window as planning", () => {
    expect(classifyWorkPhase(["Read", "Grep", "Glob", "Read"])).toBe("planning");
  });

  // Bash is neutral: it shows up in both phases, so on its own it reads as planning (no edits yet).
  it("treats Bash alone as planning, but Bash with an edit as implementing", () => {
    expect(classifyWorkPhase(["Bash"])).toBe("planning");
    expect(classifyWorkPhase(["Bash", "Write"])).toBe("implementing");
  });
});
