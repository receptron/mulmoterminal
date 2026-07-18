import { describe, it, expect } from "vitest";
import { isPrPhase, phaseDisplay, type PrPhase } from "../../../src/components/rosterPhase";

describe("isPrPhase", () => {
  it.each(["none", "draft", "ci-failing", "changes-requested", "ci-running", "ready", "merged", "closed"])("accepts %s", (v) => {
    expect(isPrPhase(v)).toBe(true);
  });

  it.each([["unknown"], [""], [null], [undefined], [1]])("rejects %s", (v) => {
    expect(isPrPhase(v)).toBe(false);
  });
});

describe("phaseDisplay", () => {
  it("renders nothing for none (no PR yet)", () => {
    expect(phaseDisplay("none")).toBeNull();
  });

  it.each<[PrPhase, string]>([
    ["draft", "draft"],
    ["ci-failing", "CI fail"],
    ["changes-requested", "changes"],
    ["ci-running", "CI…"],
    ["ready", "ready"],
    ["merged", "merged"],
    ["closed", "closed"],
  ])("gives %s the label %s with a fuller tooltip", (phase, label) => {
    const d = phaseDisplay(phase);
    expect(d?.label).toBe(label);
    expect(d?.title).toMatch(/PR|Draft/);
  });
});
